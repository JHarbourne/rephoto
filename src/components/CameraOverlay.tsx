import { useEffect, useRef, useState } from "react";
import type { LoadedImage, Side } from "../types";

interface Props {
  historic: LoadedImage | null;
  onFile: (side: Side, file: File) => void;
  onCapture: (file: File) => void;
}

interface Ghost {
  tx: number; // translate px
  ty: number;
  scale: number;
  rot: number; // radians
}

const START: Ghost = { tx: 0, ty: 0, scale: 1, rot: 0 };

/**
 * Live "rephotography" mode: shows the rear camera with the historic photo
 * ghosted on top so you can physically line up the scene, then capture a clean
 * frame to fine-tune in the point-based aligner.
 */
export default function CameraOverlay({ historic, onFile, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [opacity, setOpacity] = useState(0.5);
  const [showGrid, setShowGrid] = useState(true);
  const [ghost, setGhost] = useState<Ghost>(START);

  // Gesture bookkeeping.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    ghost: Ghost;
    dist: number;
    angle: number;
    cx: number;
    cy: number;
  } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStreamError("This browser doesn't expose a camera API.");
        setStarting(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStreamError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStreamError(
          /denied|permission/i.test(msg)
            ? "Camera permission was denied. Allow camera access and reload."
            : `Could not start the camera: ${msg}`
        );
      } finally {
        setStarting(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture();
  };

  const beginGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      gestureStart.current = {
        ghost,
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else if (pts.length === 1) {
      gestureStart.current = {
        ghost,
        dist: 0,
        angle: 0,
        cx: pts[0].x,
        cy: pts[0].y,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const start = gestureStart.current;
    if (!start) return;
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setGhost({
        scale: Math.max(0.1, start.ghost.scale * (dist / (start.dist || 1))),
        rot: start.ghost.rot + (angle - start.angle),
        tx: start.ghost.tx + (cx - start.cx),
        ty: start.ghost.ty + (cy - start.cy),
      });
    } else if (pts.length === 1) {
      setGhost({
        ...start.ghost,
        tx: start.ghost.tx + (pts[0].x - start.cx),
        ty: start.ghost.ty + (pts[0].y - start.cy),
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gestureStart.current = null;
    if (pointers.current.size > 0) beginGesture();
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setStreamError("Camera frame not ready yet.");
      return;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(
          new File([blob], "camera_capture.jpg", { type: "image/jpeg" })
        );
      },
      "image/jpeg",
      0.95
    );
  };

  const transform = `translate(${ghost.tx}px, ${ghost.ty}px) scale(${ghost.scale}) rotate(${ghost.rot}rad)`;

  return (
    <div className="camera">
      <div className="camera-stage" ref={wrapRef}>
        <video
          ref={videoRef}
          className="camera-video"
          playsInline
          autoPlay
          muted
        />

        {historic && (
          <img
            className="camera-ghost"
            src={historic.el.src}
            alt="historic overlay"
            style={{ opacity, transform }}
            draggable={false}
          />
        )}

        {showGrid && (
          <div className="camera-grid" aria-hidden>
            <span /> <span /> <span /> <span />
          </div>
        )}

        {/* Gesture surface sits above the video/ghost but below the controls. */}
        <div
          className="camera-gestures"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {streamError && (
          <div className="camera-error">
            <p>{streamError}</p>
            <p className="hint">
              Camera needs a secure (https) page and permission. On the hosted
              site it will prompt you the first time.
            </p>
          </div>
        )}
        {starting && !streamError && (
          <div className="camera-error">
            <p>Starting camera…</p>
          </div>
        )}
      </div>

      <div className="camera-controls">
        {!historic ? (
          <label className="btn file-btn">
            Load historic photo to overlay
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile("historic", f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <>
            <label className="range">
              Ghost opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <label className="range">
              Scale
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.01}
                value={ghost.scale}
                onChange={(e) =>
                  setGhost((g) => ({ ...g, scale: Number(e.target.value) }))
                }
              />
            </label>
            <label className="range">
              Rotate
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.005}
                value={ghost.rot}
                onChange={(e) =>
                  setGhost((g) => ({ ...g, rot: Number(e.target.value) }))
                }
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              Grid
            </label>
            <button className="btn" onClick={() => setGhost(START)}>
              Reset ghost
            </button>
            <button
              className="btn primary shutter"
              onClick={capture}
              disabled={!!streamError}
            >
              Capture photo
            </button>
          </>
        )}
      </div>

      <p className="camera-hint">
        Drag the ghost to move it; pinch with two fingers to zoom and rotate.
        Line up a fixed edge (roofline, window, kerb), then capture — the shot
        drops into the aligner for a pixel-perfect finish.
      </p>
    </div>
  );
}
