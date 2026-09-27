/**
 * Choosing the renderer.
 *
 * There are two engines. Remotion is the primary one and is what you get unless
 * you ask for something else. The HTML/GSAP renderer is still here because it is
 * the only one that has been compared against a rendered video frame by frame, and
 * the whole point of keeping it is that it can be asked for by name.
 *
 * The choice lives in one function rather than in every entry point, because a
 * default that each script reinvents is a default that eventually disagrees with
 * itself: one script rendering with Remotion, another quietly using HTML, and a
 * "renderer" field in the manifest that means two different things.
 */

import { CachingRenderEngine } from "./cache.js";
import { PlaywrightRenderEngine } from "./playwright-engine.js";
import { RemotionRenderEngine, type RemotionRenderEngineOptions } from "./remotion-engine.js";
import type { FrameProvider, RenderEngine } from "./types.js";

export type RendererChoice = "remotion" | "html";

export interface RenderEngineFactoryOptions {
  /** Defaults to the primary renderer. */
  renderer?: RendererChoice;
  /**
   * Directory for the content-addressed render cache. Omit it to render every
   * time, which is what a first run should do and what a test should always do.
   */
  cacheDir?: string;
  /** Forwarded to the Remotion engine. */
  remotion?: RemotionRenderEngineOptions;
  /**
   * The HTML renderer draws through a provider, and the provider lives in
   * `@hc/renderer`, which depends on this package. So it is injected rather than
   * constructed here: asking for the legacy renderer without saying how to draw
   * is an error, not a guess.
   */
  provider?: FrameProvider;
}

export function createRenderEngine(options: RenderEngineFactoryOptions = {}): RenderEngine {
  const engine = buildInner(options);
  return options.cacheDir ? new CachingRenderEngine({ inner: engine, cacheDir: options.cacheDir }) : engine;
}

function buildInner(options: RenderEngineFactoryOptions): RenderEngine {
  if (options.renderer === "html") {
    if (!options.provider) {
      throw new Error(
        "the html renderer needs a frame provider; pass provider: new HtmlFrameProvider() from @hc/renderer",
      );
    }
    return new PlaywrightRenderEngine({ provider: options.provider });
  }
  return new RemotionRenderEngine(options.remotion ?? {});
}

/** The renderer's name, for logs and manifests. */
export function rendererName(engine: RenderEngine): string {
  return engine.id.replace(/\+cache$/, "");
}
