import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AlignmentResult,
  CropRect,
  Pair,
  PreviewMode,
} from "../types";
import { completePairs } from "../lib/align";

interface Props {
  result: AlignmentResult | null;
  crop: CropRect | null;
  mode: PreviewMode;
  opacity: number;
  sliderPos: number;
  blinkSpeed: number;
  showPoints: boolean;
  pairs: Pair[];
  onSliderChange: (pos: number) => void;
}

export default function PreviewPanel({
  result,
  crop,
  mode,
  opacity,
  sliderPos,
  blinkSpeed,
  showPoints,
  pairs,
  onSliderChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [blinkModern, setBlinkModern] = useState(false);

  const rect: CropRect | null = result
    ? crop ?? { x: 0, y: 0, width: result.frameWidth, height: result.frameHeight }
    : null;

  // Blink timer.
  useEffect(() => {
    if (mode !== "blink") return;
    const id = window.setInterval(
      () => setBlinkModern((b) => !b),
      Math.max(120, blinkSpeed)
    );
    return () => window.clearInterval(id);
  }, [mode, blinkSpeed]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !result || !rect) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = container.clientWidth;
    const scale = cssW / rect.width;
    const cssH = rect.height * scale;

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const drawLayer = (src: HTMLCanvasElement) =>
      ctx.drawImage(
        src,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        cssW,
        cssH
      );

    if (mode === "opacity") {
      drawLayer(result.historicCanvas);
      ctx.globalAlpha = opacity;
      drawLayer(result.modernCanvas);
      ctx.globalAlpha = 1;
    } else if (mode === "blink") {
      drawLayer(blinkModern ? result.modernCanvas : result.historicCanvas);
    } else {
      // slider: historic underneath, modern revealed from the left.
      drawLayer(result.historicCanvas);
      const split = sliderPos * cssW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, split, cssH);
      ctx.clip();
      drawLayer(result.modernCanvas);
      ctx.restore();
      // divider
      ctx.beginPath();
      ctx.moveTo(split, 0);
      ctx.lineTo(split, cssH);
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.arc(split, cssH / 2, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showPoints) {
      const pts = completePairs(pairs);
      for (let i = 0; i < pts.length; i++) {
        const h = pts[i].historic;
        const px = (h.x - rect.x) * scale;
        const py = (h.y - rect.y) * scale;
        if (px < 0 || py < 0 || px > cssW || py > cssH) continue;
        ctx.strokeStyle = "rgba(255,60,60,0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - 8, py);
        ctx.lineTo(px + 8, py);
        ctx.moveTo(px, py - 8);
        ctx.lineTo(px, py + 8);
        ctx.stroke();
      }
    }
  }, [result, rect, mode, opacity, sliderPos, blinkModern, showPoints, pairs]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const updateSliderFromEvent = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const pos = (e.clientX - r.left) / r.width;
    onSliderChange(Math.max(0, Math.min(1, pos)));
  };

  return (
    <div className="preview">
      {result ? (
        <div
          ref={containerRef}
          className={`canvas-wrap ${mode === "slider" ? "slider-cursor" : ""}`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={(e) => {
              if (mode !== "slider") return;
              draggingRef.current = true;
              updateSliderFromEvent(e);
            }}
            onMouseMove={(e) => {
              if (mode === "slider" && draggingRef.current)
                updateSliderFromEvent(e);
            }}
            onMouseUp={() => (draggingRef.current = false)}
            onMouseLeave={() => (draggingRef.current = false)}
          />
        </div>
      ) : (
        <div className="preview-empty">
          Upload both images and add matched points, then press{" "}
          <strong>Align</strong> to see the before/after overlay here.
        </div>
      )}
    </div>
  );
}
