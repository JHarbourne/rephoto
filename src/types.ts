/** A point in image-pixel coordinates (origin top-left). */
export interface Pt {
  x: number;
  y: number;
}

export type Side = "historic" | "modern";

/**
 * A matching control-point pair. Either half may be unset while the user is
 * mid-placement; only pairs where both halves are present are used to solve
 * the alignment. Pairs are numbered by their position in the pairs array.
 */
export interface Pair {
  id: string;
  historic?: Pt;
  modern?: Pt;
}

export interface Selection {
  pairId: string;
  side: Side;
}

export interface LoadedImage {
  /** Object URL / data source, kept for re-draws. */
  el: HTMLImageElement;
  width: number;
  height: number;
  name: string;
}

export type WarpType = "homography" | "tps";

export type PreviewMode = "slider" | "opacity" | "blink";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Output of the alignment pipeline. Both canvases share identical dimensions. */
export interface AlignmentResult {
  /** Historic image drawn into the shared (historic-sized) frame. */
  historicCanvas: HTMLCanvasElement;
  /** Modern image warped into the shared frame. */
  modernCanvas: HTMLCanvasElement;
  /** Full frame size before any crop. */
  frameWidth: number;
  frameHeight: number;
  /** Bounding box (in frame coords) where the warped modern image has data. */
  coverage: CropRect;
  warpType: WarpType;
  /** Row-major 3x3 homography (modern -> historic). Present for homography. */
  homography?: number[];
  /** Mean reprojection error of control points, in pixels. */
  rmsError: number;
}

export interface AlignmentJSON {
  app: "photo-aligner";
  version: number;
  createdAt: string;
  historicImage: { name: string; width: number; height: number };
  modernImage: { name: string; width: number; height: number };
  warp: {
    type: WarpType;
    /** Row-major 3x3, modern -> historic (homography only). */
    matrix?: number[];
  };
  controlPoints: Array<{
    index: number;
    historic: Pt;
    modern: Pt;
  }>;
  crop: CropRect | null;
  outputSize: { width: number; height: number };
  rmsError: number;
}
