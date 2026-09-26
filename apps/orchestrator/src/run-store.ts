import { HealthOSError, ensureDirAsync, pathExists, readJson, writeJsonAtomic } from "@hc/core";
import { join } from "node:path";
import {
  OrchestratorRunSchema,
  canTransition,
  type OrchestratorRun,
  type RunState,
} from "./run-schema.js";

/**
 * One directory per run, one JSON document inside it.
 *
 * The document is the source of truth and it is written atomically, so a crash
 * mid-write leaves either the previous state or the new one, never half of
 * either. That is what makes `resume()` trustworthy after a hard kill.
 */
export class RunStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  runDir(runId: string): string {
    return join(this.root, runId);
  }

  runPath(runId: string): string {
    return join(this.runDir(runId), "run.json");
  }

  storyboardPath(runId: string): string {
    return join(this.runDir(runId), "storyboard.json");
  }

  /**
   * Where the build input is kept.
   *
   * A resume has to be able to rebuild the storyboard without the original
   * caller still in memory, so the input is part of the run's durable state
   * rather than a closure the process is holding onto.
   */
  buildInputPath(runId: string): string {
    return join(this.runDir(runId), "build-input.json");
  }

  framesDir(runId: string): string {
    return join(this.runDir(runId), "frames");
  }

  videoPath(runId: string): string {
    return join(this.runDir(runId), "video.mp4");
  }

  async create(run: OrchestratorRun): Promise<OrchestratorRun> {
    await ensureDirAsync(this.runDir(run.run_id));
    // The opening state is an attempt like any other, so the record of what a
    // run did starts at the beginning rather than at the first thing that
    // changed.
    const opened = OrchestratorRunSchema.parse({
      ...run,
      attempts: [{ state: run.state, started_at: run.created_at, finished_at: run.created_at, ok: true }],
    });
    await this.save(opened);
    return opened;
  }

  async save(run: OrchestratorRun): Promise<void> {
    const parsed = OrchestratorRunSchema.parse({ ...run, updated_at: new Date().toISOString() });
    await ensureDirAsync(this.runDir(parsed.run_id));
    await writeJsonAtomic(this.runPath(parsed.run_id), parsed);
  }

  async load(runId: string): Promise<OrchestratorRun | null> {
    const path = this.runPath(runId);
    if (!(await pathExists(path))) {
      return null;
    }
    return OrchestratorRunSchema.parse(await readJson(path));
  }

  async list(): Promise<OrchestratorRun[]> {
    const { readdir } = await import("node:fs/promises");
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      return [];
    }
    const runs: OrchestratorRun[] = [];
    for (const entry of entries) {
      const run = await this.load(entry).catch(() => null);
      if (run) {
        runs.push(run);
      }
    }
    return runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * Records a state change, refusing anything the machine does not allow.
   *
   * The check is here rather than at the call site because a run that walks
   * through an impossible state is corrupt even if it happens to finish.
   */
  async transition(
    run: OrchestratorRun,
    to: RunState,
    patch: Partial<OrchestratorRun> = {},
  ): Promise<OrchestratorRun> {
    if (run.state !== to && !canTransition(run.state, to)) {
      throw new HealthOSError(`illegal run transition ${run.state} -> ${to}`, {
        category: "INVALID_REQUEST",
      });
    }
    const now = new Date().toISOString();
    const next = OrchestratorRunSchema.parse({
      ...run,
      ...patch,
      state: to,
      updated_at: now,
      attempts: [
        ...run.attempts,
        { state: to, started_at: now, finished_at: now, ok: to !== "FAILED" },
      ].slice(-200),
    });
    await this.save(next);
    return next;
  }
}
