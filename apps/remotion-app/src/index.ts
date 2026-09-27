/**
 * Bundle entry point.
 *
 * `registerRoot` is the only thing Remotion needs. Nothing else in this file runs
 * in a browser: the composition tree, the palette, and the motion utilities are
 * all pure, which is why a frame can be reproduced from a seed and a storyboard
 * hash without loading the app.
 */

import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root.js";

registerRoot(RemotionRoot);
