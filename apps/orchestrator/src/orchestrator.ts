import {
  HealthOSError,
  ensureDirAsync,
  pathExists,
  readJson,
  sha256,
  writeJsonAtomic,
} from "@hc/core";
import { fitSegments, readWavInfo, type TtsProvider } from "@hc/audio";
import { buildStoryboard, type BuildStoryboardInput } from "@hc/storyboard";
import { toRenderProject, type RenderEngine, type RenderProject } from "@hc/render";
import { StoryboardSchema, type Storyboard } from "@hc/schemas";
import type { RunStore } from "./run-store.js";
import {
  OrchestratorRunSchema,
  type OrchestratorRun,
  type RunAudio,
  type SceneTiming,
  type ValidationReport,
} from "./run-schema.js";
import {
  DEFAULT_TIMING_POLICY,
  hasBlockingIssue,
  validateFinal,
  validateTiming,
  type TimingPolicy,
} from "./validate.js";

export interface OrchestratorDeps {
  store: RunStore;
  tts: TtsProvider;
  engine: RenderEngine;
  policy?: TimingPolicy;
}

export interface RunRequest {
  runId: string;
  build: BuildStoryboardInput;
}

export interface RunOutcome {
  run: OrchestratorRun;
  storyboard: Storyboard;
  videoPath: string;
  timing: ValidationReport;
  final: ValidationReport;
}

/**
 * The production loop, as an explicit state machine.
 *
 * The order is the whole point. A storyboard is planned on estimates, the voice
 * is asked what the words actually cost, the storyboard is rebuilt on those
 * numbers, and only then is anything validated. Rendering sits downstream of a
 * validated timeline and never gets a vote on it.
 *
 * Each state is written to disk before the next begins, so a crash costs at
 * most the step in flight and `resume()` picks up from there.
 */
export class Orchestrator {
  private readonly store: RunStore;
  private readonly tts: TtsProvider;
  private readonly engine: RenderEngine;
  private readonly policy: TimingPolicy;

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store;
    this.tts = deps.tts;
    this.engine = deps.engine;
    this.policy = deps.policy ?? DEFAULT_TIMING_POLICY;
  }

  /** Starts a run, or continues one that already exists under the same id. */
  async run(request: RunRequest): Promise<RunOutcome> {
    const existing = await this.store.load(request.runId);
    if (existing) {
      return this.resume(request.runId);
    }
    return this.start(request);
  }

  private async start(request: RunRequest): Promise<RunOutcome> {
    const now = new Date().toISOString();
    const storyboard = (buildStoryboard(request.build).storyboard);
    const run = OrchestratorRunSchema.parse({
      run_id: request.runId,
      video_id: storyboard.video_id,
      topic_id: storyboard.topic_id,
      topic: storyboard.topic,
      state: "PLANNED",
      storyboard_version: storyboard.version,
      script_hash: storyboard.script_hash,
      target_duration_s: request.build.draft.target_ms / 1000,
      storyboard_path: this.store.storyboardPath(request.runId),
      storyboard_hash: digestOf(storyboard),
      work_dir: this.store.runDir(request.runId),
      created_at: now,
      updated_at: now,
    });
    await this.store.create(run);
    // The input is persisted so a resume can rebuild without the caller.
    await writeJsonAtomic(this.store.buildInputPath(request.runId), request.build);
    await this.persistStoryboard(request.runId, storyboard);
    return this.resume(request.runId);
  }

  /** The only supported way back into a run, including after a hard kill. */
  async resume(runId: string): Promise<RunOutcome> {
    let run = await this.requireRun(runId);
    const request = await this.loadBuildInput(runId);

    if (run.state === "FAILED") {
      // Re-enter at the step that failed, never from the top: resynthesis is the
      // expensive one and a render failure has no reason to repeat it.
      run = await this.store.transition(run, resumeEntry(run), { error: "" });
    }
    if (run.state === "READY") {
      return this.outcome(run);
    }

    let storyboard = await this.loadStoryboard(run);

    if (run.state === "PLANNED") {
      run = await this.synthesise(run);
      storyboard = await this.loadStoryboard(run);
    }
    if (run.state === "AUDIO_SYNTHESIZED") {
      run = await this.measure(run, storyboard);
      storyboard = await this.loadStoryboard(run);
    }
    if (run.state === "AUDIO_MEASURED") {
      run = await this.rebuild(run, request);
      storyboard = await this.loadStoryboard(run);
    }
    if (run.state === "STORYBOARD_REBUILT") {
      const timing = validateTiming(storyboard, run.scene_timings, this.policy);
      run = await this.store.transition(run, "TIMING_VALIDATED", {
        timing_validation: timing,
      });
      if (hasBlockingIssue(timing)) {
        throw await this.rejection(run, timing, "timeline rejected before rendering");
      }
    }
    if (run.state === "TIMING_VALIDATED") {
      run = await this.store.transition(run, "RENDERING");
    }
    if (run.state === "RENDERING") {
      // Reached two ways: first attempt from a validated timeline, and retry
      // after a failure. Both render the audio that is already on disk.
      run = await this.renderOrFail(run, storyboard);
      storyboard = await this.loadStoryboard(run);
    }
    if (run.state === "RENDERED") {
      const final = validateFinal(
        storyboard,
        {
          videoPath: run.render?.video_path ?? "",
          videoDurationS: run.render?.video_duration_s ?? 0,
          audioPath: run.audio?.path ?? "",
          audioDurationS: run.audio?.track_duration_s ?? 0,
          plannedDurationS: storyboard.duration,
          sceneCount: storyboard.scenes.length,
          frameCount: run.render?.frames ?? 0,
          captionCount: storyboard.narration.segments.length,
        },
        this.policy,
      );
      run = await this.store.transition(run, "FINAL_VALIDATED", {
        final_validation: final,
      });
      if (hasBlockingIssue(final)) {
        throw await this.rejection(run, final, "finished file rejected");
      }
    }
    if (run.state === "FINAL_VALIDATED") {
      run = await this.store.transition(run, "READY");
    }
    return this.outcome(run);
  }

  /**
   * Asks the voice for one continuous track.
   *
   * Every line goes into a single call. One file per scene would add the
   * engine's utterance pad to every scene, and the video would grow by seconds
   * of dead air that nobody chose.
   */
  private async synthesise(run: OrchestratorRun): Promise<OrchestratorRun> {
    if (run.audio) {
      return run;
    }
    const storyboard = await this.loadStoryboard(run);
    await ensureDirAsync(run.work_dir);
    const outPath = `${run.work_dir}/narration.wav`;
    const track = await this.tts.synthesiseTrack(
      storyboard.scenes.map((s) => s.narration),
      outPath,
    );
    const wav = readWavInfo(track.audio_path);
    const audio: RunAudio = {
      path: track.audio_path,
      hash: track.audio_hash,
      sample_rate: wav.sample_rate,
      channels: wav.channels,
      line_content_s: [],
      content_duration_s: 0,
      speech_duration_s: track.duration_s,
      track_duration_s: track.duration_s,
      // The track's own length is known, but where the words sit inside it is
      // not, and guessing here is what produced captions that drifted.
      lead_s: 0,
      tail_s: 0,
      sentence_pause_s: this.tts.profile.utterance_overhead_s,
    };
    return this.store.transition(run, "AUDIO_SYNTHESIZED", {
      audio,
      synth_count: run.synth_count + 1,
    });
  }

  /**
   * Learns how long each line really takes.
   *
   * Measuring is necessarily a second pass: the engine only reports a boundary
   * when it is given a single line, and producing the track needs one call for
   * all of them. The two totals therefore differ, and reconciling them is
   * {@link fitSegments}' job rather than this one's.
   */
  private async measure(run: OrchestratorRun, storyboard: Storyboard): Promise<OrchestratorRun> {
    const audio = run.audio;
    if (!audio) {
      throw new HealthOSError("run has no audio to measure", { category: "INVALID_REQUEST" });
    }
    if (audio.line_content_s.length === storyboard.scenes.length) {
      return run;
    }
    const measured = await this.tts.measureAll(storyboard.scenes.map((s) => s.narration));
    if (measured.length !== storyboard.scenes.length) {
      throw new HealthOSError(
        `measured ${measured.length} lines for ${storyboard.scenes.length} scenes`,
        { category: "INTERNAL" },
      );
    }
    const contentS = measured.reduce((sum, value) => sum + Math.max(0, value), 0);
    return this.store.transition(run, "AUDIO_MEASURED", {
      audio: {
        ...audio,
        line_content_s: measured.map((value) => round3(value)),
        content_duration_s: round3(contentS),
        // The spoken span runs from the first word to the last. `fitSegments`
        // resolves the lead and tail when the rebuild lays the lines down, so
        // they stay zero here rather than being guessed at.
        speech_duration_s: round3(audio.track_duration_s),
      },
    });
  }

  /**
   * Rebuilds the storyboard on the recording, and lays the shots onto the track.
   *
   * Two rules, both learned the hard way. The video is sized to the audio,
   * because trimming the audio to the plan discards the end of the track and the
   * end of the track is the disclaimer. And each shot starts when its line
   * starts, so the engine's sentence pauses fall inside shots instead of being
   * averaged away.
   */
  private async rebuild(
    run: OrchestratorRun,
    request: BuildStoryboardInput | null,
  ): Promise<OrchestratorRun> {
    const audio = run.audio;
    if (!audio || !request) {
      return run;
    }
    const planned = buildStoryboard({
      ...request,
      plan: { ...(request.plan ?? {}), total_s: audio.track_duration_s },
    }).storyboard;
    const fitted = fitSegments(audio.line_content_s, audio.track_duration_s, {
      sentence_pause_s: audio.sentence_pause_s,
      lead_s: audio.lead_s,
    });
    const rebuilt = this.layOntoTrack(planned, fitted, audio);
    await this.persistStoryboard(run.run_id, rebuilt);

    const sceneTimings: SceneTiming[] = rebuilt.scenes.map((scene, index) => ({
      scene_id: scene.scene_id,
      index,
      start_s: scene.start,
      end_s: scene.end,
      duration_s: round3(scene.end - scene.start),
      speech_s: audio.line_content_s[index] ?? 0,
    }));
    return this.store.transition(run, "STORYBOARD_REBUILT", {
      storyboard_version: rebuilt.version,
      storyboard_hash: digestOf(rebuilt),
      scene_timings: sceneTimings,
      audio: {
        ...audio,
        lead_s: fitted[0]?.start_s ?? 0,
        tail_s: round3(
          audio.track_duration_s - (fitted.at(-1)?.end_s ?? audio.track_duration_s),
        ),
        speech_duration_s: round3(
          (fitted.at(-1)?.end_s ?? 0) - (fitted[0]?.start_s ?? 0),
        ),
      },
    });
  }

  /**
   * Places shots and captions on the continuous track.
   *
   * Shot `i` runs from the start of line `i` to the start of line `i + 1`, and
   * the last one runs to the end of the track. The engine's pauses therefore
   * belong to the shot that was speaking when they happened, every caption sits
   * inside its own shot, and the shots tile the file with no gaps.
   */
  private layOntoTrack(
    planned: Storyboard,
    fitted: { start_s: number; end_s: number }[],
    audio: RunAudio,
  ): Storyboard {
    const trackS = audio.track_duration_s;
    const scenes = planned.scenes.map((scene, index) => {
      const line = fitted[index];
      const next = fitted[index + 1];
      const start = round3(line?.start_s ?? scene.start);
      const end = round3(
        index === planned.scenes.length - 1 ? trackS : (next?.start_s ?? scene.end),
      );
      return { ...scene, start, end: Math.max(start, end) };
    });
    const segments = planned.scenes.map((scene, index) => {
      const line = fitted[index];
      const text = scene.narration;
      return {
        segment_id: `${scene.scene_id}_seg`,
        scene_id: scene.scene_id,
        text,
        start_s: round3(line?.start_s ?? scene.start),
        // Never past the shot it belongs to, and never so short it flashes.
        end_s: round3(
          Math.max(
            (line?.end_s ?? scene.start) + 0.001,
            Math.min(
              scenes[index]?.end ?? scene.end,
              (line?.end_s ?? scene.start) + MIN_CAPTION_S,
            ),
          ),
        ),
        rate: 1,
      };
    });
    return StoryboardSchema.parse({
      ...planned,
      scenes,
      duration: round3(scenes.at(-1)?.end ?? trackS),
      narration: {
        ...planned.narration,
        duration_s: round3(trackS),
        audio_path: audio.path,
        audio_hash: audio.hash,
        sample_rate: audio.sample_rate,
        channels: audio.channels,
        segments,
        timing: {
          ...planned.narration.timing,
          source: "measured",
          track_duration_s: round3(trackS),
          content_duration_s: round3(audio.content_duration_s),
          speech_duration_s: round3((fitted.at(-1)?.end_s ?? 0) - (fitted[0]?.start_s ?? 0)),
          lead_s: round3(fitted[0]?.start_s ?? 0),
          tail_s: round3(trackS - (fitted.at(-1)?.end_s ?? trackS)),
          sentence_pause_s: round3(audio.sentence_pause_s),
          line_count: segments.length,
        },
      },
    });
  }

  /**
   * Renders, recording a failure before rethrowing.
   *
   * A browser that dies mid-render is the ordinary case, not an exceptional
   * one, so the failure is written to the run: that is what lets the next
   * `resume()` re-enter at rendering with the audio untouched.
   */
  private async renderOrFail(
    run: OrchestratorRun,
    storyboard: Storyboard,
  ): Promise<OrchestratorRun> {
    try {
      return await this.render(run, storyboard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.transition(run, "FAILED", { error: message.slice(0, 600) });
      throw error;
    }
  }

  private async render(run: OrchestratorRun, storyboard: Storyboard): Promise<OrchestratorRun> {
    const audio = run.audio;
    if (!audio) {
      throw new HealthOSError("cannot render without audio", { category: "INVALID_REQUEST" });
    }
    const project: RenderProject = toRenderProject(storyboard, {
      path: audio.path,
      duration_s: audio.track_duration_s,
      hash: audio.hash,
      sample_rate: audio.sample_rate,
      channels: audio.channels,
    });
    const result = await this.engine.render(project, {
      workDir: run.work_dir,
      videoPath: this.store.videoPath(run.run_id),
    });
    return this.store.transition(run, "RENDERED", {
      render: {
        renderer_id: result.renderer_id,
        renderer_version: result.renderer_version,
        video_path: result.video_path,
        video_duration_s: result.video_duration_s,
        audio_duration_s: result.audio_duration_s,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        frames: result.frames,
        cache_hit: result.cache_hit,
      },
      render_count: run.render_count + 1,
    });
  }

  private async requireRun(runId: string): Promise<OrchestratorRun> {
    const run = await this.store.load(runId);
    if (!run) {
      throw new HealthOSError(`no run ${runId}`, { category: "MISSING_ASSET" });
    }
    return run;
  }

  private async loadStoryboard(run: OrchestratorRun): Promise<Storyboard> {
    return StoryboardSchema.parse(await readJson(run.storyboard_path));
  }

  private async loadBuildInput(runId: string): Promise<BuildStoryboardInput | null> {
    const path = this.store.buildInputPath(runId);
    if (!(await pathExists(path))) {
      return null;
    }
    return await readJson<BuildStoryboardInput>(path);
  }

  private async persistStoryboard(runId: string, storyboard: Storyboard): Promise<void> {
    await writeJsonAtomic(this.store.storyboardPath(runId), storyboard);
  }

  private async outcome(run: OrchestratorRun): Promise<RunOutcome> {
    return {
      run,
      storyboard: await this.loadStoryboard(run),
      videoPath: run.render?.video_path ?? this.store.videoPath(run.run_id),
      timing: run.timing_validation ?? emptyReport(),
      final: run.final_validation ?? emptyReport(),
    };
  }

  private async rejection(
    run: OrchestratorRun,
    validation: ValidationReport,
    message: string,
  ): Promise<HealthOSError> {
    const detail = validation.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    const text = `${message}: ${detail}`;
    // Awaited, not fired: a caller that catches this and immediately reloads
    // the run must find the failure already written.
    await this.store.transition(run, "FAILED", { error: text.slice(0, 600) });
    return new HealthOSError(text, { category: "INVALID_REQUEST" });
  }
}

/** A caption shorter than this cannot be read, so it is treated as a defect. */
const MIN_CAPTION_S = 0.2;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Where a failed run re-enters, chosen by how far its artefacts got.
 *
 * Each branch names the next step still to be done, not the step that failed, so
 * the answer stays correct whether the failure was an exception or a rejected
 * validation.
 */
function resumeEntry(run: OrchestratorRun): OrchestratorRun["state"] {
  if (run.render) {
    return "RENDERING";
  }
  if (run.timing_validation) {
    return "TIMING_VALIDATED";
  }
  if (run.scene_timings.length > 0) {
    return "STORYBOARD_REBUILT";
  }
  if (run.audio && run.audio.line_content_s.length > 0) {
    return "AUDIO_MEASURED";
  }
  if (run.audio) {
    return "AUDIO_SYNTHESIZED";
  }
  return "PLANNED";
}

function emptyReport(): ValidationReport {
  return { ok: true, checked_at: new Date().toISOString(), issues: [], facts: {} };
}

function digestOf(value: unknown): string {
  return sha256(JSON.stringify(value));
}
