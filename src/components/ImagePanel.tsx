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

const HIT_PX = 22; // finger-friendly hit radius, in screen px
const TAP_SLOP = 7; // movement under this (screen px) counts as a tap
const MAX_ZOOM = 10;

interface View {
  scale: number; // css px per image px
  ox: number; // css px offset
  oy: number;
}

type Action =
  | { kind: "point"; pairId: string }
  | { kind: "tapOrPan"; startX: number; startY: number; moved: boolean }
  | { kind: "pinch"; startDist: number; startScale: number; cx: number; cy: number; startOx: number; startOy: number }
  | null;

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
  const view = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const fitScale = useRef(1);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const action = useRef<Action>(null);

  const sidePoints = pairs
    .map((p, i) => ({ pair: p, index: i, pt: p[side], complete: !!(p.historic && p.modern) }))
    .filter((e) => e.pt);

  const canvasMetrics = () => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { rect, cssW: rect.width, cssH: rect.height };
  };

  const clampView = (cssW: number, cssH: number) => {
    const v = view.current;
    const iw = image!.width * v.scale;
    const ih = image!.height * v.scale;
    // keep the image covering / centered within the viewport
    v.ox = iw <= cssW ? (cssW - iw) / 2 : Math.min(0, Math.max(cssW - iw, v.ox));
    v.oy = ih <= cssH ? (cssH - ih) / 2 : Math.min(0, Math.max(cssH - ih, v.oy));
  };

  const fit = () => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !image) return;
    const cssW = container.clientWidth;
    const cssH = image.height * (cssW / image.width);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    fitScale.current = cssW / image.width;
    view.current = { scale: fitScale.current, ox: 0, oy: 0 };
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const v = view.current;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.el, v.ox, v.oy, image.width * v.scale, image.height * v.scale);

    if (!showPoints) return;
    for (const e of sidePoints) {
      const px = e.pt!.x * v.scale + v.ox;
      const py = e.pt!.y * v.scale + v.oy;
      const selected = selection?.pairId === e.pair.id && selection?.side === side;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fillStyle = e.complete ? "rgba(46,204,113,0.85)" : "rgba(241,196,15,0.9)";
      ctx.fill();
      ctx.lineWidth = selected ? 3.5 : 2;
      ctx.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,0.55)";
      ctx.stroke();
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
    const ro = new ResizeObserver(() => {
      fit();
      draw();
    });
    ro.observe(container);
    fit();
    draw();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const toLocal = (e: React.PointerEvent) => {
    const { rect } = canvasMetrics();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const screenToImage = (x: number, y: number) => {
    const v = view.current;
    return { x: (x - v.ox) / v.scale, y: (y - v.oy) / v.scale };
  };
  const hitTest = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestD = HIT_PX * HIT_PX;
    for (const e of sidePoints) {
      const px = e.pt!.x * view.current.scale + view.current.ox;
      const py = e.pt!.y * view.current.scale + view.current.oy;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e.pair.id;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      action.current = {
        kind: "pinch",
        startDist: Math.hypot(b.x - a.x, b.y - a.y),
        startScale: view.current.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        startOx: view.current.ox,
        startOy: view.current.oy,
      };
      return;
    }

    const hit = hitTest(p.x, p.y);
    if (hit) {
      onSelect(hit, side);
      action.current = { kind: "point", pairId: hit };
    } else {
      action.current = { kind: "tapOrPan", startX: p.x, startY: p.y, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toLocal(e);
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);
    const act = action.current;
    if (!act) return;
    const { cssW, cssH } = canvasMetrics();

    if (act.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const min = fitScale.current;
      const next = Math.max(min, Math.min(min * MAX_ZOOM, act.startScale * (dist / (act.startDist || 1))));
      // keep the pinch focal point stable, and follow the two-finger pan
      const imgX = (act.cx - act.startOx) / act.startScale;
      const imgY = (act.cy - act.startOy) / act.startScale;
      view.current.scale = next;
      view.current.ox = cx - imgX * next;
      view.current.oy = cy - imgY * next;
      clampView(cssW, cssH);
      draw();
      return;
    }

    if (act.kind === "point") {
      const im = screenToImage(p.x, p.y);
      const cl = {
        x: Math.max(0, Math.min(image!.width, im.x)),
        y: Math.max(0, Math.min(image!.height, im.y)),
      };
      onMove(act.pairId, side, cl.x, cl.y);
      return;
    }

    if (act.kind === "tapOrPan") {
      const movedNow = Math.hypot(p.x - act.startX, p.y - act.startY) > TAP_SLOP;
      if (movedNow) act.moved = true;
      if (act.moved) {
        view.current.ox += p.x - prev.x;
        view.current.oy += p.y - prev.y;
        clampView(cssW, cssH);
        draw();
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    const act = action.current;
    pointers.current.delete(e.pointerId);

    if (act?.kind === "tapOrPan" && !act.moved && p) {
      const im = screenToImage(p.x, p.y);
      if (addMode) {
        onPlace(
          side,
          Math.max(0, Math.min(image!.width, im.x)),
          Math.max(0, Math.min(image!.height, im.y))
        );
      }
    }

    if (pointers.current.size === 0) action.current = null;
    else if (pointers.current.size === 1) {
      // dropped from pinch back to one finger — resume panning cleanly
      const [only] = [...pointers.current.values()];
      action.current = { kind: "tapOrPan", startX: only.x, startY: only.y, moved: true };
    }
  };

  const resetZoom = () => {
    fit();
    draw();
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
          <span className="panel-actions">
            <button
              className="mini-btn"
              onClick={resetZoom}
              title="Reset zoom"
              aria-label="Reset zoom"
            >
              Reset zoom
            </button>
            <span className="panel-meta">
              {image.width}×{image.height}
            </span>
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
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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
