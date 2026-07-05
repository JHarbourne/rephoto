import { getCV } from "../opencv/loadOpenCV";
import type { AlignmentResult, LoadedImage, Pair, WarpType } from "../types";
import { evalTPS, fitTPS } from "./tps";

export interface AlignOptions {
  warpType: WarpType;
  /** Interpolation used for the final warp. Cubic preserves detail best. */
  cubic?: boolean;
}

interface ReadyPair {
  historic: { x: number; y: number };
  modern: { x: number; y: number };
}

/** Filter to complete pairs (both halves placed). */
export function completePairs(pairs: Pair[]): ReadyPair[] {
  const out: ReadyPair[] = [];
  for (const p of pairs) {
    if (p.historic && p.modern) {
      out.push({ historic: p.historic, modern: p.modern });
    }
  }
  return out;
}

function imageToCanvas(img: LoadedImage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img.el, 0, 0);
  return c;
}

/** Minimum control points required for each warp type. */
export function minPoints(warpType: WarpType): number {
  return warpType === "homography" ? 4 : 3;
}

/**
 * Solve the alignment and warp the modern image into the historic frame.
 * Colours and content are never modified — the modern pixels are only
 * geometrically resampled to match the historic viewpoint.
 */
export function align(
  historic: LoadedImage,
  modern: LoadedImage,
  pairs: Pair[],
  opts: AlignOptions
): AlignmentResult {
  const cv = getCV();
  const ready = completePairs(pairs);
  const need = minPoints(opts.warpType);
  if (ready.length < need) {
    throw new Error(
      `Need at least ${need} matched point pairs for ${opts.warpType}; have ${ready.length}.`
    );
  }

  const frameWidth = historic.width;
  const frameHeight = historic.height;
  const interp = opts.cubic ? cv.INTER_CUBIC : cv.INTER_LINEAR;

  const modernCv = imageToCanvas(modern);
  const src = cv.imread(modernCv); // RGBA
  const warped = new cv.Mat();
  const dsize = new cv.Size(frameWidth, frameHeight);
  const black = new cv.Scalar(0, 0, 0, 0);

  // Coverage mask: warp a solid image so we can find where modern data lands.
  const solid = new cv.Mat(
    modern.height,
    modern.width,
    cv.CV_8UC1,
    new cv.Scalar(255)
  );
  const mask = new cv.Mat();

  let homography: number[] | undefined;
  let rmsError = 0;

  try {
    if (opts.warpType === "homography") {
      const srcPts = cv.matFromArray(
        ready.length,
        1,
        cv.CV_32FC2,
        ready.flatMap((p) => [p.modern.x, p.modern.y])
      );
      const dstPts = cv.matFromArray(
        ready.length,
        1,
        cv.CV_32FC2,
        ready.flatMap((p) => [p.historic.x, p.historic.y])
      );
      const method = ready.length > 4 ? cv.RANSAC : 0;
      const H = cv.findHomography(srcPts, dstPts, method, 3);
      if (H.empty()) {
        throw new Error(
          "Could not compute a homography from these points. Try spreading points across the frame."
        );
      }
      homography = Array.from(H.data64F as Float64Array);
      rmsError = homographyRms(homography, ready);

      cv.warpPerspective(
        src,
        warped,
        H,
        dsize,
        interp,
        cv.BORDER_CONSTANT,
        black
      );
      cv.warpPerspective(
        solid,
        mask,
        H,
        dsize,
        cv.INTER_NEAREST,
        cv.BORDER_CONSTANT,
        new cv.Scalar(0)
      );

      srcPts.delete();
      dstPts.delete();
      H.delete();
    } else {
      // Thin plate spline: build dense sampling maps over the historic frame.
      const model = fitTPS(
        ready.map((p) => p.historic),
        ready.map((p) => p.modern)
      );
      rmsError = tpsRms(model, ready);

      // Evaluate on a coarse grid (TPS is smooth) then upscale — much faster
      // than evaluating the transcendental basis at every output pixel.
      const scale = Math.min(1, 600 / Math.max(frameWidth, frameHeight));
      const cw = Math.max(2, Math.round(frameWidth * scale));
      const ch = Math.max(2, Math.round(frameHeight * scale));
      const mapXc = new cv.Mat(ch, cw, cv.CV_32FC1);
      const mapYc = new cv.Mat(ch, cw, cv.CV_32FC1);
      const xd = mapXc.data32F as Float32Array;
      const yd = mapYc.data32F as Float32Array;
      for (let j = 0; j < ch; j++) {
        const fy = ch === 1 ? 0 : (j / (ch - 1)) * (frameHeight - 1);
        for (let i = 0; i < cw; i++) {
          const fx = cw === 1 ? 0 : (i / (cw - 1)) * (frameWidth - 1);
          const s = evalTPS(model, fx, fy);
          const idx = j * cw + i;
          xd[idx] = s.x;
          yd[idx] = s.y;
        }
      }
      const mapX = new cv.Mat();
      const mapY = new cv.Mat();
      cv.resize(mapXc, mapX, dsize, 0, 0, cv.INTER_LINEAR);
      cv.resize(mapYc, mapY, dsize, 0, 0, cv.INTER_LINEAR);

      cv.remap(src, warped, mapX, mapY, interp, cv.BORDER_CONSTANT, black);
      cv.remap(
        solid,
        mask,
        mapX,
        mapY,
        cv.INTER_NEAREST,
        cv.BORDER_CONSTANT,
        new cv.Scalar(0)
      );

      mapXc.delete();
      mapYc.delete();
      mapX.delete();
      mapY.delete();
    }

    // Compute coverage bounding box by scanning the warped solid mask.
    // (cv.findNonZero is not present in every OpenCV.js build, so do it here.)
    const coverage = boundingBoxOfMask(
      mask.data as Uint8Array,
      frameWidth,
      frameHeight
    );

    // Render results to canvases.
    const modernCanvas = document.createElement("canvas");
    modernCanvas.width = frameWidth;
    modernCanvas.height = frameHeight;
    cv.imshow(modernCanvas, warped);

    const historicCanvas = document.createElement("canvas");
    historicCanvas.width = frameWidth;
    historicCanvas.height = frameHeight;
    historicCanvas.getContext("2d")!.drawImage(historic.el, 0, 0);

    return {
      historicCanvas,
      modernCanvas,
      frameWidth,
      frameHeight,
      coverage,
      warpType: opts.warpType,
      homography,
      rmsError,
    };
  } finally {
    src.delete();
    warped.delete();
    solid.delete();
    mask.delete();
  }
}

/** Bounding box of the non-zero pixels of a single-channel (CV_8UC1) mask. */
function boundingBoxOfMask(
  data: Uint8Array,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function homographyRms(h: number[], pairs: ReadyPair[]): number {
  let sum = 0;
  for (const p of pairs) {
    const w = h[6] * p.modern.x + h[7] * p.modern.y + h[8];
    const px = (h[0] * p.modern.x + h[1] * p.modern.y + h[2]) / w;
    const py = (h[3] * p.modern.x + h[4] * p.modern.y + h[5]) / w;
    const dx = px - p.historic.x;
    const dy = py - p.historic.y;
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / pairs.length);
}

function tpsRms(
  model: ReturnType<typeof fitTPS>,
  pairs: ReadyPair[]
): number {
  let sum = 0;
  for (const p of pairs) {
    const s = evalTPS(model, p.historic.x, p.historic.y);
    const dx = s.x - p.modern.x;
    const dy = s.y - p.modern.y;
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / pairs.length);
}
