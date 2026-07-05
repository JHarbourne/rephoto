import type {
  AlignmentJSON,
  AlignmentResult,
  CropRect,
  LoadedImage,
  Pair,
} from "../types";
import { completePairs } from "./align";

/** Crop a canvas to a rect, returning a fresh canvas. */
export function cropCanvas(
  source: HTMLCanvasElement,
  rect: CropRect
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width));
  out.height = Math.max(1, Math.round(rect.height));
  out.getContext("2d")!.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height
  );
  return out;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      type,
      quality
    );
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export interface ExportImagesResult {
  width: number;
  height: number;
}

/**
 * Export the aligned pair as two JPEGs cropped to the same dimensions.
 * If `crop` is null the full frame is exported.
 */
export async function exportImages(
  result: AlignmentResult,
  crop: CropRect | null,
  quality = 0.95
): Promise<ExportImagesResult> {
  const rect: CropRect =
    crop ?? {
      x: 0,
      y: 0,
      width: result.frameWidth,
      height: result.frameHeight,
    };

  const historic = cropCanvas(result.historicCanvas, rect);
  const modern = cropCanvas(result.modernCanvas, rect);

  const [hBlob, mBlob] = await Promise.all([
    canvasToBlob(historic, "image/jpeg", quality),
    canvasToBlob(modern, "image/jpeg", quality),
  ]);

  triggerDownload(hBlob, "historic_aligned.jpg");
  triggerDownload(mBlob, "modern_aligned.jpg");

  return { width: historic.width, height: historic.height };
}

export function buildAlignmentJSON(
  historic: LoadedImage,
  modern: LoadedImage,
  pairs: Pair[],
  result: AlignmentResult | null,
  crop: CropRect | null,
  now: string
): AlignmentJSON {
  const ready = completePairs(pairs);
  const outputSize = crop
    ? { width: Math.round(crop.width), height: Math.round(crop.height) }
    : {
        width: result?.frameWidth ?? historic.width,
        height: result?.frameHeight ?? historic.height,
      };

  return {
    app: "photo-aligner",
    version: 1,
    createdAt: now,
    historicImage: {
      name: historic.name,
      width: historic.width,
      height: historic.height,
    },
    modernImage: {
      name: modern.name,
      width: modern.width,
      height: modern.height,
    },
    warp: {
      type: result?.warpType ?? "homography",
      matrix: result?.homography,
    },
    controlPoints: ready.map((p, i) => ({
      index: i + 1,
      historic: p.historic,
      modern: p.modern,
    })),
    crop,
    outputSize,
    rmsError: result?.rmsError ?? 0,
  };
}

export function exportAlignmentJSON(json: AlignmentJSON): void {
  const blob = new Blob([JSON.stringify(json, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, "alignment.json");
}
