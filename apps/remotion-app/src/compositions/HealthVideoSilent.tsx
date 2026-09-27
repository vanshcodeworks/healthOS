/**
 * The same frames, with no audio element.
 *
 * This exists for two practical reasons, and neither of them is a preference:
 *
 * 1. Some publishing targets reject a video that contains an audio stream they
 *    cannot verify. A silent render uploads cleanly and the platform attaches the
 *    already-measured track itself.
 * 2. Frame-exact visual diffing is cleaner without an audio element, because the
 *    comparison is then purely about pixels.
 *
 * It renders the identical scene and caption tree as `HealthVideo`. If the two
 * ever produce different frames, that is a bug in `HealthVideoBody`, not in here.
 */

import type { FC } from "react";
import type { HealthVideoProps } from "../props.js";
import { HealthVideoBody } from "./HealthVideo.js";

export const HealthVideoSilent: FC<HealthVideoProps> = (props) => (
  <HealthVideoBody props={props} audio={false} />
);
