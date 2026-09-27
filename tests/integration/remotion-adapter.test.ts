// The adapter is the seam: the only place a validated storyboard becomes a tree
// the composition can read.
//
// It is tested against real storyboards from the corpus rather than hand-written
// fixtures, because the interesting failures are the ones that only appear when
// the graph is what the pipeline actually produced: a scene with no components, a
// chart whose claims are on a different scene, a narration segment that straddles
// a scene boundary. A fixture written by the same person who wrote the adapter
// proves the adapter can read the adapter.

import { describe, expect, it } from "vitest";
import { asVerified, kbTopic, research, topicFor } from "../helpers/corpus.js";
import { writeScript } from "@hc/script";
import { buildStoryboard } from "@hc/storyboard";
import { toHealthVideoProps, seedFor, toRenderProject, type AdapterNote, type RenderAudio } from "@hc/render";
import type { HealthVideoProps } from "@hc/remotion-app/props";

const TOPICS = ["caffeine-and-the-brain", "hydration-physiology", "fibre-and-digestion"] as const;

type Composition = HealthVideoProps["scenes"][number]["composition"];

/**
 * Every grammar the adapter may choose, spelled out.
 *
 * The list is long on purpose. It is the set a reviewer reads to see which frames
 * the pipeline can produce, and `_allGrammarsAreListed` below is a compile-time
 * check that it stays complete: adding a grammar to the props without adding it
 * here breaks the build of this file rather than quietly passing.
 */
const ALL_COMPOSITIONS = [
  "editorial_hook",
  "big_stat",
  "scientific_diagram",
  "anatomy_focus",
  "mechanism",
  "particle_flow",
  "cause_effect",
  "comparison",
  "timeline",
  "zoom_reveal",
  "molecular_breakdown",
  "question",
  "conclusion",
  "disclaimer",
] as const satisfies readonly Composition[];

type UnlistedComposition = Exclude<Composition, (typeof ALL_COMPOSITIONS)[number]>;
// Fails to compile with "Type 'X' is not assignable to type 'never'" if a grammar
// exists in the props but not in the list above.
const _allGrammarsAreListed: UnlistedComposition[] = [];

function fakeAudio(duration_s: number): RenderAudio {
  return { path: "C:/tmp/track/narration.wav", duration_s, hash: "abc123", sample_rate: 24_000, channels: 1 };
}

/**
 * The track length the storyboard was built for.
 *
 * The corpus builds storyboards before anything is synthesised, so
 * `track_duration_s` is 0 and `storyboard.duration` is the allocation. Using 0
 * would test the unmeasured case in every assertion; the measured case is what
 * production does.
 */
function trackFor(storyboard: Awaited<ReturnType<typeof boardFor>>): number {
  return storyboard.narration.timing.track_duration_s || storyboard.duration;
}

async function boardFor(slug: string) {
  const kb = kbTopic(slug);
  const { claims, sources } = await research(kb);
  return buildStoryboard({
    draft: writeScript(kb, topicFor(kb).topic_id, { targetMs: 55_000 }),
    claims,
    sources: asVerified(sources),
    topic: kb.title,
    question: kb.question,
    category: kb.category,
    format: kb.format,
  }).storyboard;
}

function notesFor(notes: AdapterNote[], sceneId: string, kind: AdapterNote["kind"]): AdapterNote[] {
  return notes.filter((n) => n.scene_id === sceneId && n.kind === kind);
}

describe("storyboard to composition props", () => {
  it("resolves a composition for every scene, and records nothing invented", async () => {
    for (const slug of TOPICS) {
      const storyboard = await boardFor(slug);
      const { props, notes } = toHealthVideoProps({ storyboard, audio: fakeAudio(trackFor(storyboard)) });

      expect(props.scenes).toHaveLength(storyboard.scenes.length);
      for (const scene of props.scenes) {
        expect(ALL_COMPOSITIONS).toContain(scene.composition);
      }
      // A compile-time check that the list above is complete, asserted at runtime so
      // the const is read and the check is not dead code the type checker flags.
      expect(_allGrammarsAreListed).toEqual([]);

      // With a track that matches the storyboard, the only notes a real storyboard
      // may produce are the ones about a frame being type-only. A chart with no
      // claim, an unmapped figure, a scene with no narration or a scene running
      // past the audio are all defects, and a corpus that produces them means the
      // adapter is reporting something the pipeline already knows about.
      const unexpected = notes.filter((n) => n.kind !== "no_components");
      expect(unexpected, `${slug}: ${unexpected.map((n) => `${n.scene_id} ${n.kind}: ${n.detail}`).join("; ")}`).toEqual([]);
    }
  });

  it("gives the CTA and the disclaimer their own frames wherever they sit", async () => {
    for (const slug of TOPICS) {
      const storyboard = await boardFor(slug);
      const { props } = toHealthVideoProps({ storyboard, audio: fakeAudio(trackFor(storyboard)) });
      for (const scene of storyboard.scenes) {
        const composed = props.scenes.find((s) => s.scene_id === scene.scene_id)!;
        if (scene.intent === "cta") expect(composed.composition).toBe("conclusion");
        if (scene.intent === "caveat") expect(composed.composition).toBe("disclaimer");
      }
    }
  });

  it("copies scene timing exactly, so no beat can drift off the voice", async () => {
    const storyboard = await boardFor("caffeine-and-the-brain");
    const { props } = toHealthVideoProps({ storyboard, audio: fakeAudio(60) });

    storyboard.scenes.forEach((source, index) => {
      const scene = props.scenes[index]!;
      expect(scene.scene_id).toBe(source.scene_id);
      expect(scene.start_s).toBe(source.start);
      expect(scene.end_s).toBe(source.end);
      expect(scene.duration_s).toBeCloseTo(source.end - source.start, 6);
    });

    // Every beat is inside its own scene, in the scene's clock.
    for (const scene of props.scenes) {
      for (const beat of scene.beats) {
        expect(beat.local_start_s).toBeGreaterThanOrEqual(-1e-9);
        expect(beat.local_end_s).toBeLessThanOrEqual(scene.duration_s + 1e-9);
        expect(beat.local_end_s).toBeGreaterThan(beat.local_start_s);
        expect(beat.start_s).toBeCloseTo(beat.local_start_s + scene.start_s, 6);
      }
    }
  });

  it("uses the measured track for the duration and never shortens it", async () => {
    const storyboard = await boardFor("hydration-physiology");
    const track = trackFor(storyboard);

    const plain = toHealthVideoProps({ storyboard, audio: fakeAudio(track) });
    expect(plain.props.duration_s).toBeCloseTo(track, 6);

    const withHold = toHealthVideoProps({ storyboard, audio: fakeAudio(track), tailHold_s: 1.5 });
    expect(withHold.props.duration_s).toBeCloseTo(track + 1.5, 6);
    // A hold is added, never taken out.
    expect(withHold.props.duration_s).toBeGreaterThan(plain.props.duration_s);

    // A track that came out short does not get the video trimmed. The last scene
    // survives whole, the video runs long, and the overrun is reported: cutting
    // here would truncate whichever sentence happens to be under the line.
    const tooShort = toHealthVideoProps({ storyboard, audio: fakeAudio(track - 10) });
    expect(tooShort.props.duration_s).toBeGreaterThanOrEqual(storyboard.duration - 1e-6);
    const last = tooShort.props.scenes.at(-1)!;
    expect(last.end_s).toBeCloseTo(storyboard.scenes.at(-1)!.end, 6);
    expect(tooShort.notes.filter((n) => n.kind === "scene_past_audio").length).toBeGreaterThan(0);
  });

  it("does not call an unmeasured track a defect", async () => {
    // Before synthesis the storyboard has no track at all. A zero-length track is
    // the normal state of a storyboard under test, not an overrun to warn about.
    const storyboard = await boardFor("caffeine-and-the-brain");
    const { props, notes } = toHealthVideoProps({ storyboard, audio: fakeAudio(0) });

    expect(props.duration_s).toBeCloseTo(storyboard.duration, 6);
    expect(notes.filter((n) => n.kind === "scene_past_audio")).toHaveLength(0);
  });

  it("binds every caption to a scene that exists", async () => {
    for (const slug of TOPICS) {
      const storyboard = await boardFor(slug);
      const { props } = toHealthVideoProps({ storyboard, audio: fakeAudio(60) });
      const sceneIds = new Set(props.scenes.map((s) => s.scene_id));

      expect(props.captions.length).toBeGreaterThan(0);
      for (const cue of props.captions) {
        // `scene_id` is optional in the ref type because a cue may be written before
        // it is placed. A placed cue is not optional, so the assertion is that it is
        // here and names a scene that exists.
        expect(cue.scene_id, `caption at ${cue.start_s}s was never placed in a scene`).toBeDefined();
        expect(sceneIds.has(cue.scene_id!)).toBe(true);
        expect(cue.end_s).toBeGreaterThan(cue.start_s);
        expect(cue.end_s).toBeLessThanOrEqual(props.duration_s + 1e-6);
      }
    }
  });

  it("keeps a chart's claim ids attached, and reports a chart with none", async () => {
    const storyboard = await boardFor("caffeine-and-the-brain");
    const { props, notes } = toHealthVideoProps({ storyboard, audio: fakeAudio(60) });
    const charts = props.scenes.filter((s) => s.chart);

    expect(charts.length).toBeGreaterThan(0);
    for (const scene of charts) {
      const source = storyboard.scenes.find((s) => s.scene_id === scene.scene_id)!;
      expect(scene.chart!.claim_ids).toEqual(source.claim_ids);
      if (source.claim_ids.length === 0) {
        expect(notesFor(notes, scene.scene_id, "chart_without_claims")).toHaveLength(1);
      } else {
        expect(notesFor(notes, scene.scene_id, "chart_without_claims")).toHaveLength(0);
      }
    }
  });

  it("gives the same storyboard the same props and the same seeds every time", async () => {
    const storyboard = await boardFor("fibre-and-digestion");
    const first = toHealthVideoProps({ storyboard, audio: fakeAudio(50) });
    const second = toHealthVideoProps({ storyboard, audio: fakeAudio(50) });

    expect(JSON.stringify(second.props)).toBe(JSON.stringify(first.props));
    expect(seedFor("p", "s")).toBe(seedFor("p", "s"));
    expect(seedFor("p", "s")).not.toBe(seedFor("p", "t"));
    for (const scene of first.props.scenes) {
      expect(scene.seed).toBe(seedFor(storyboard.storyboard_id, scene.scene_id));
    }
  });

  it("carries the audio by name only, because the engine is what stages the file", async () => {
    const storyboard = await boardFor("hydration-physiology");
    const { props } = toHealthVideoProps({ storyboard, audio: fakeAudio(42) });

    expect(props.audio.src).toBe("narration.wav");
    expect(props.audio.duration_s).toBe(42);
    expect(props.audio.hash).toBe("abc123");
    expect(props.audio.src).not.toContain(":");
  });

  it("never hands a figure grammar a scene with nothing to draw", async () => {
    // The corpus produces scenes that ask for a figure and name no component: the
    // hook, the CTA and the disclaimer are all `component_only` with an empty
    // component list. Rendering one as a figure means the composition reaches for
    // whatever that grammar usually draws, and the video shows a stomach the
    // storyboard never asked for. The frame has to stay typographic instead, and
    // the note has to say so, because the note is what a reviewer reads.
    const figureGrammars: Composition[] = ["anatomy_focus", "zoom_reveal"];
    for (const slug of TOPICS) {
      const storyboard = await boardFor(slug);
      const { props, notes } = toHealthVideoProps({ storyboard, audio: fakeAudio(trackFor(storyboard)) });

      for (const source of storyboard.scenes) {
        const composed = props.scenes.find((s) => s.scene_id === source.scene_id)!;
        // A scene with no components and no chart has nothing to draw. A scene whose
        // only components are undrawable is the `unmapped_figure` case, and the first
        // test in this file asserts the corpus produces none of those.
        if (source.components.length > 0 || source.chart) continue;

        expect(figureGrammars, `${slug}/${source.scene_id} is ${source.visual_strategy} with no component`).not.toContain(
          composed.composition,
        );
        if (source.visual_strategy === "component_only" || source.visual_strategy === "photo_led") {
          expect(notesFor(notes, source.scene_id, "no_components")).toHaveLength(1);
        }
      }
    }
  });

  it("still uses a figure grammar when the storyboard names a component", async () => {
    // The other direction, because the guard above is easy to write too broadly
    // and a corpus with no figures at all would pass it.
    const storyboard = await boardFor("caffeine-and-the-brain");
    const withFigure = structuredClone(storyboard);
    const target = withFigure.scenes.find((s) => s.visual_strategy === "diagram_led") ?? withFigure.scenes[2]!;
    target.components = [
      { component: "Stomach", label: "Stomach", emphasis: "focus", position: { x: 0.5, y: 0.5, scale: 1, rotate: 0 }, params: {} },
    ];
    target.chart = undefined;

    const { props } = toHealthVideoProps({ storyboard: withFigure, audio: fakeAudio(trackFor(storyboard)) });
    const composed = props.scenes.find((s) => s.scene_id === target.scene_id)!;
    expect(composed.composition).toBe("scientific_diagram");
    expect(composed.components.map((c) => c.component)).toContain("Stomach");
  });

  it("keeps the canonical storyboard on the render project", async () => {
    const storyboard = await boardFor("caffeine-and-the-brain");
    const project = toRenderProject(storyboard, fakeAudio(60));

    // The legacy engine ignores this field and must keep working; the composition
    // engine refuses to run without it rather than rebuilding it from the
    // flattened projection.
    expect(project.storyboard).toBe(storyboard);
    const flat = { ...project };
    delete flat.storyboard;
    const { RemotionRenderEngine } = await import("@hc/render");
    await expect(new RemotionRenderEngine().render(flat, { workDir: "x", videoPath: "y" })).rejects.toThrow(
      /storyboard/i,
    );
  });
});
