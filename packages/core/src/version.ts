export const RUNTIME_VERSION = "1.0.0";

/**
 * Bumping this invalidates every cached render, because rendered pixels are a
 * pure function of (storyboard, assets, RENDERER_VERSION, RUNTIME_VERSION).
 */
export const RENDERER_VERSION = "1.0.0";
