import { useEffect, useRef, useState } from "react";
import type { LoadedImage, Side } from "../types";

interface Props {
  historic: LoadedImage | null;
  onFile: (side: Side, file: File) => void;
  onCapture: (file: File) => void;
  onExit: () => void;
}

interface Ghost {
  tx: number;
  ty: number;
  scale: number;
}

const START: Ghost = { tx: 0, ty: 0, scale: 1 };

/**
 * Full-screen live "rephotography" mode: the rear camera fills the screen with
 * the historic photo ghosted on top. Thumb sliders (opacity left, scale right)
 * and a big shutter keep everything in reach in landscape. Capturing shows an
 * in-app review to compare and keep or retake — no browser download screen.
 */
export default function CameraOverlay({
  historic,
  onFile,
  onCapture,
  onExit,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [opacity, setOpacity] = useState(0.5);
  const [ghost, setGhost] = useState<Ghost>(START);
  const [captured, setCaptured] = useState<{ url: string; file: File } | null>(
    null
  );
  const [flash, setFlash] = useState(false);

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    ghost: Ghost;
    dist: number;
    cx: number;
    cy: number;
  } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStreamError("This browser doesn't provide camera access.");
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
          /denied|permission|notallowed/i.test(msg)
            ? "Camera access was blocked. Allow the camera for this site, then reopen this tab."
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

  // --- ghost positioning (drag = move, pinch = scale; no rotation) ---
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
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    } else if (pts.length === 1) {
      gestureStart.current = { ghost, dist: 0, cx: pts[0].x, cy: pts[0].y };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = gestureStart.current;
    if (!s) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setGhost({
        scale: Math.max(0.1, Math.min(4, s.ghost.scale * (dist / (s.dist || 1)))),
        tx: s.ghost.tx + (cx - s.cx),
        ty: s.ghost.ty + (cy - s.cy),
      });
    } else if (pts.length === 1) {
      setGhost({
        ...s.ghost,
        tx: s.ghost.tx + (pts[0].x - s.cx),
        ty: s.ghost.ty + (pts[0].y - s.cy),
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gestureStart.current = null;
    if (pointers.current.size > 0) beginGesture();
  };

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setStreamError("Camera frame not ready yet — give it a second.");
      return;
    }
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "rephoto-capture.jpg", {
          type: "image/jpeg",
        });
        setCaptured({ url: URL.createObjectURL(file), file });
      },
      "image/jpeg",
      0.95
    );
  };

  const retake = () => {
    if (captured) URL.revokeObjectURL(captured.url);
    setCaptured(null);
  };

  const save = async () => {
    if (!captured) return;
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData) => boolean;
    };
    if (nav.canShare && nav.canShare({ files: [captured.file] })) {
      try {
        await navigator.share({
          files: [captured.file],
          title: "Rephoto capture",
        });
        return;
      } catch {
        /* user cancelled the share sheet — fall through to download */
      }
    }
    const a = document.createElement("a");
    a.href = captured.url;
    a.download = captured.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const useInAligner = () => {
    if (captured) onCapture(captured.file);
  };

  const ready = !streamError && !starting;
  const transform = `translate(${ghost.tx}px, ${ghost.ty}px) scale(${ghost.scale})`;

  // ---------- Review screen ----------
  if (captured) {
    return (
      <div className="cam cam--review">
        <div className="cam-review__grid">
          <figure className="cam-review__cell">
            <span className="cam-review__tag">Historic</span>
            {historic ? (
              <img src={historic.el.src} alt="historic" />
            ) : (
              <div className="cam-review__none">No historic loaded</div>
            )}
          </figure>
          <figure className="cam-review__cell">
            <span className="cam-review__tag">Your new photo</span>
            <img src={captured.url} alt="captured" />
          </figure>
        </div>
        <div className="cam-review__bar">
          <button className="cam-btn ghost" onClick={retake}>
            ↺ Retake
          </button>
          <button className="cam-btn" onClick={save}>
            ⇪ Save to Photos
          </button>
          <button className="cam-btn primary" onClick={useInAligner}>
            Use in aligner →
          </button>
        </div>
      </div>
    );
  }

  // ---------- Live camera ----------
  return (
    <div className="cam">
      <video ref={videoRef} className="cam-video" playsInline autoPlay muted />

      {historic && (
        <img
          className="cam-ghost"
          src={historic.el.src}
          alt=""
          style={{ opacity, transform }}
          draggable={false}
        />
      )}

      <div className="cam-grid" aria-hidden>
        <span /> <span /> <span /> <span />
      </div>

      {/* gesture surface for positioning the ghost */}
      <div
        className="cam-gestures"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {flash && <div className="cam-flash" aria-hidden />}

      {/* top bar */}
      <div className="cam-top">
        <button className="cam-chip" onClick={onExit}>
          ✕ Cancel
        </button>
        <label className="cam-chip">
          {historic ? "Change historic photo" : "Load historic photo"}
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
      </div>

      {/* thumb controls (only meaningful once a ghost is loaded) */}
      {historic && (
        <>
          <div className="cam-slider cam-slider--left">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              aria-label="Ghost opacity"
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <span className="cam-slider__label">opacity</span>
          </div>
          <div className="cam-slider cam-slider--right">
            <input
              type="range"
              min={0.3}
              max={3}
              step={0.01}
              value={ghost.scale}
              aria-label="Ghost scale"
              onChange={(e) =>
                setGhost((g) => ({ ...g, scale: Number(e.target.value) }))
              }
            />
            <span className="cam-slider__label">scale</span>
          </div>
        </>
      )}

      {/* big shutter */}
      <button
        className="cam-shutter"
        onClick={shoot}
        disabled={!ready}
        aria-label="Take photo"
      >
        <span />
      </button>

      {!historic && ready && (
        <p className="cam-hint">
          Load a historic photo to ghost over the scene, then line it up and
          shoot.
        </p>
      )}
      {(streamError || starting) && (
        <div className="cam-status">
          {streamError ? (
            <>
              <p>{streamError}</p>
              <button className="cam-chip" onClick={onExit}>
                ← Back
              </button>
            </>
          ) : (
            <p>Starting camera…</p>
          )}
        </div>
      )}
    </div>
  );
}
