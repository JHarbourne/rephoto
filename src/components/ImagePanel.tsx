import { useCallback, useEffect, useRef } from "react";
import type { LoadedImage, Pair, Selection, Side } from "../types";

interface Props {
  title: string;
  side: Side;
  image: LoadedImage | null;
  pairs: Pair[];
  selection: Selection | null;
  showPoints: boolean;
  addMode: boolean;
  onPlace: (side: Side, x: number, y: number) => void;
  onSelect: (pairId: string, side: Side) => void;
  onMove: (pairId: string, side: Side, x: number, y: number) => void;
  onFile: (side: Side, file: File) => void;
}

const HIT_RADIUS = 14; // in image px, scaled by zoom at hit-test time

interface DragState {
  pairId: string;
  side: Side;
}

export default function ImagePanel({
  title,
  side,
  image,
  pairs,
  selection,
  showPoints,
  addMode,
  onPlace,
  onSelect,
  onMove,
  onFile,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  // Points on this side, tagged with their pair number (1-based).
  const sidePoints = pairs
    .map((p, i) => ({ pair: p, index: i, pt: p[side], complete: !!(p.historic && p.modern) }))
    .filter((e) => e.pt);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !image) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = container.clientWidth;
    const scaleImg = cssW / image.width; // css px per image px
    const cssH = image.height * scaleImg;

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // work in CSS px
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(image.el, 0, 0, cssW, cssH);

    if (!showPoints) return;

    for (const e of sidePoints) {
      const px = e.pt!.x * scaleImg;
      const py = e.pt!.y * scaleImg;
      const selected =
        selection?.pairId === e.pair.id && selection?.side === side;

      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = e.complete
        ? "rgba(46, 204, 113, 0.85)"
        : "rgba(241, 196, 15, 0.9)";
      ctx.fill();
      ctx.lineWidth = selected ? 3.5 : 2;
      ctx.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,0.55)";
      ctx.stroke();

      // crosshair
      ctx.beginPath();
      ctx.moveTo(px - 13, py);
      ctx.lineTo(px + 13, py);
      ctx.moveTo(px, py - 13);
      ctx.lineTo(px, py + 13);
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 3;
      ctx.strokeText(String(e.index + 1), px, py + 1);
      ctx.fillText(String(e.index + 1), px, py + 1);
    }
  }, [image, sidePoints, selection, side, showPoints]);

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

  const eventToImage = (e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleImg = rect.width / image.width;
    const x = (e.clientX - rect.left) / scaleImg;
    const y = (e.clientY - rect.top) / scaleImg;
    return { x: Math.max(0, Math.min(image.width, x)), y: Math.max(0, Math.min(image.height, y)) };
  };

  const hitTest = (x: number, y: number): DragState | null => {
    let best: DragState | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const e of sidePoints) {
      const dx = e.pt!.x - x;
      const dy = e.pt!.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = { pairId: e.pair.id, side };
      }
    }
    return best;
  };

  const handleDown = (e: React.MouseEvent) => {
    const p = eventToImage(e);
    if (!p) return;

    const hit = hitTest(p.x, p.y);
    if (hit && !addMode) {
      onSelect(hit.pairId, hit.side);
      dragRef.current = hit;
      return;
    }
    if (addMode) {
      onPlace(side, p.x, p.y);
      return;
    }
    if (hit) {
      onSelect(hit.pairId, hit.side);
      dragRef.current = hit;
    }
  };

  const handleMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const p = eventToImage(e);
    if (!p) return;
    onMove(dragRef.current.pairId, dragRef.current.side, p.x, p.y);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onFile(side, file);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        {image && (
          <span className="panel-meta">
            {image.width}×{image.height}
          </span>
        )}
      </div>

      {image ? (
        <div
          ref={containerRef}
          className={`canvas-wrap ${addMode ? "add-mode" : ""}`}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          />
        </div>
      ) : (
        <label
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(side, f);
              e.currentTarget.value = "";
            }}
          />
          <span>Drop {title.toLowerCase()} here or click to upload</span>
        </label>
      )}
    </div>
  );
}
