/**
 * Live viewpoint guidance for rephotography.
 *
 * When you re-take an old photo, getting the framing right is not the same as
 * standing in the right place. Zoom scales the whole picture uniformly; moving
 * your feet creates *parallax* — near and far things shift by different amounts,
 * and the two visible faces of a building change their relative widths. That
 * face-width ratio is a direct, zoom-independent cue for your left/right
 * position, which is exactly what this computes.
 *
 * The user marks three features in each photo: the near vertical corner where
 * the two faces meet, and the outer edge of each face. We compare the ratio of
 * the two faces' horizontal widths between the old photo (the target) and the
 * current view, and translate the difference into "move left" / "move right".
 *
 * Coordinates are fractions (0–1) of each image, which is all the ratio needs —
 * it is scale-invariant, so the two photos need not share dimensions.
 */

export interface Frac {
  x: number;
  y: number;
}

/** The three marks: the near corner and the outer edge of each visible face. */
export interface FacePins {
  corner: Frac;
  /** Outer edge of the face on the left of the corner in the image. */
  left: Frac;
  /** Outer edge of the face on the right of the corner in the image. */
  right: Frac;
}

/**
 * Fraction of the total visible façade taken up by the left-hand face, 0–1.
 * 0.5 means the two faces look equally wide (a symmetric, head-on-to-the-corner
 * viewpoint); higher means the left face dominates.
 */
export function faceBalance(p: FacePins): number {
  const leftWidth = Math.abs(p.corner.x - p.left.x);
  const rightWidth = Math.abs(p.right.x - p.corner.x);
  const total = leftWidth + rightWidth;
  return total > 1e-6 ? leftWidth / total : 0.5;
}

export type ViewpointAxis = "left" | "right" | "ok";

export interface ViewpointHint {
  axis: ViewpointAxis;
  /** 0–1: how far off you are, for wording / arrow emphasis. */
  strength: number;
  /** Target (old photo) left-face fraction. */
  balanceTarget: number;
  /** Current view left-face fraction. */
  balanceNow: number;
}

/**
 * Compare the current view's face balance to the old photo's and say which way
 * to step. Moving toward a face makes it look wider, so if the left face is
 * wider now than in the original you have drifted left — step right to restore
 * the original viewpoint (and vice versa).
 *
 * @param deadband ratio difference below which we call it good (default 0.03).
 * @param fullScale ratio difference treated as "strongly off" (default 0.25).
 */
export function viewpointHint(
  target: FacePins,
  now: FacePins,
  deadband = 0.03,
  fullScale = 0.25
): ViewpointHint {
  const balanceTarget = faceBalance(target);
  const balanceNow = faceBalance(now);
  const delta = balanceNow - balanceTarget; // + => left face too wide now
  const strength = Math.min(1, Math.abs(delta) / fullScale);
  if (Math.abs(delta) <= deadband) {
    return { axis: "ok", strength: 0, balanceTarget, balanceNow };
  }
  // Left face too wide now → you moved left → correct by moving right.
  return {
    axis: delta > 0 ? "right" : "left",
    strength,
    balanceTarget,
    balanceNow,
  };
}
