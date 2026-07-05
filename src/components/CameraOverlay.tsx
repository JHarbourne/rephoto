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

// The size slider is logarithmic so 100% (scale 1) sits dead centre, with equal
// travel to shrink (down to 1/FACTOR) or grow (up to FACTOR).
const SIZE_FACTOR = 2.5;

// Largest rect of a given aspect ratio that fits (centred) inside a box.
function containRect(boxW: number, boxH: number, aspect: number) {
  const boxAspect = boxW / boxH;
  let w = boxW;
  let h = boxH;
  if (aspect > boxAspect) h = boxW / aspect;
  else w = boxH * aspect;
  return { w, h, left: (boxW - w) / 2, top: (boxH - h) / 2 };
}

/**
 * Full-screen live "rephotography" mode. The camera fills the screen and the
 * old photo is ghosted on top; drag to move it, pinch (or the slider) to size
 * it, and fade it with opacity. Line the scene up under it and shoot — the
 * saved photo is cropped to exactly where the ghost sits, so it comes out the
 * same shape and framing as the old one: a matched before/after pair.
 */
export default function CameraOverlay({
  historic,
  onFile,
  onCapture,
  onExit,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [opacity, setOpacity] = useState(0.5);
  const [ghost, setGhost] = useState<Ghost>(START);
  const [captured, setCaptured] = useState<{
    url: string;
    file: File;
  } | null>(null);
  const [flash, setFlash] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Track the on-screen size so the capture can map the ghost's position back to
  // camera pixels (recomputed on rotate/resize).
  useEffect(() => {
    const update = () => {
      const el = videoRef.current;
      setBox({
        w: el?.clientWidth || window.innerWidth,
        h: el?.clientHeight || window.innerHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

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
        // Ask for a high-res rear stream (clamped gracefully via `ideal`) so
        // captures stay sharp.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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

  // Returning from the review screen mounts a fresh <video>, so re-attach the
  // live stream — otherwise it stays black.
  useEffect(() => {
    if (!captured && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [captured]);

  // --- ghost positioning: drag = move, pinch = scale (no rotation) ---
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
        scale: Math.max(
          0.2,
          Math.min(5, s.ghost.scale * (dist / (s.dist || 1)))
        ),
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
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const bw = box.w || window.innerWidth;
    const bh = box.h || window.innerHeight;
    // Where the ghost sits on screen: its object-fit: contain rect, moved and
    // scaled by the drag/pinch transform (origin = screen centre). The capture
    // grabs exactly this region so the new photo matches the old one's shape
    // and framing. With no historic loaded, capture the whole view.
    let g;
    if (historic) {
      const cr = containRect(bw, bh, historic.width / historic.height);
      const gw = cr.w * ghost.scale;
      const gh = cr.h * ghost.scale;
      g = {
        left: bw / 2 + ghost.tx - gw / 2,
        top: bh / 2 + ghost.ty - gh / 2,
        w: gw,
        h: gh,
      };
    } else {
      g = { left: 0, top: 0, w: bw, h: bh };
    }
    // Map screen coords -> camera source pixels (video is object-fit: cover,
    // centred in the box).
    const coverScale = Math.max(bw / vw, bh / vh);
    const sx = vw / 2 + (g.left - bw / 2) / coverScale;
    const sy = vh / 2 + (g.top - bh / 2) / coverScale;
    const sw = g.w / coverScale;
    const sh = g.h / coverScale;
    const outW = Math.max(1, Math.round(sw));
    const outH = Math.max(1, Math.round(sh));
    const c = document.createElement("canvas");
    c.width = outW;
    c.height = outH;
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
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
      share?: (d: ShareData) => Promise<void>;
    };
    // Prefer the share sheet ("Save Image"); if cancelled, stay put rather than
    // dropping into the browser download screen.
    if (nav.share && nav.canShare && nav.canShare({ files: [captured.file] })) {
      try {
        await nav.share({ files: [captured.file], title: "Rephoto capture" });
      } catch {
        /* cancelled or failed */
      }
      return;
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
        <div className="cam-review__top">
          <button className="cam-chip" onClick={retake}>
            ✕ Back to camera
          </button>
        </div>
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
      {historic && (
        <div
          className="cam-gestures"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}

      {flash && <div className="cam-flash" aria-hidden />}

      {/* top bar */}
      <div className="cam-top">
        <button className="cam-chip" onClick={onExit}>
          ⇄ Align photos
        </button>
        {historic && (
          <label className="cam-chip">
            Change historic photo
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
        )}
      </div>

      {/* clear call to action when nothing is loaded yet */}
      {!historic && ready && (
        <div className="cam-load">
          <label className="cam-load__btn">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
            Load historic photo
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
          <p className="cam-load__sub">
            Ghost it over the scene, then line it up and shoot.
          </p>
        </div>
      )}

      {/* Thumb controls (only meaningful once a ghost is loaded). Size on the
          left, opacity on the right by the shutter. */}
      {historic && (
        <>
          <div className="cam-slider cam-slider--left">
            <input
              type="range"
              min={-1}
              max={1}
              step={0.005}
              value={Math.log(ghost.scale) / Math.log(SIZE_FACTOR)}
              aria-label="Ghost size"
              onChange={(e) =>
                setGhost((g) => ({
                  ...g,
                  scale: Math.pow(SIZE_FACTOR, Number(e.target.value)),
                }))
              }
            />
            <span className="cam-slider__label">
              {Math.round(ghost.scale * 100)}%
            </span>
          </div>
          <div className="cam-slider cam-slider--right">
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
