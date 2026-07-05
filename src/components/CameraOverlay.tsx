import { useEffect, useRef, useState } from "react";
import type { LoadedImage, Side } from "../types";

interface Props {
  historic: LoadedImage | null;
  onFile: (side: Side, file: File) => void;
  onCapture: (file: File) => void;
  onExit: () => void;
}

// Largest rect of a given aspect ratio that fits (centred) inside a box —
// the "contain" rect. Used to frame the capture to the historic photo's shape.
function containRect(boxW: number, boxH: number, aspect: number) {
  const boxAspect = boxW / boxH;
  let w = boxW;
  let h = boxH;
  if (aspect > boxAspect) h = boxW / aspect;
  else w = boxH * aspect;
  return { w, h, left: (boxW - w) / 2, top: (boxH - h) / 2 };
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * Full-screen live "rephotography" mode. The historic photo is locked into a
 * capture frame shaped exactly like it; the rest of the screen is dimmed. You
 * move the phone (and zoom the camera to match the old lens) until the live
 * scene lines up under the ghost, then shoot. The captured photo is cropped to
 * the frame, so it comes out the same aspect AND crop as the historic — a
 * matched pair for a before/after slider.
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
  const [zoom, setZoom] = useState(1);
  const [captured, setCaptured] = useState<{
    url: string;
    file: File;
    diag: string;
  } | null>(null);
  const [flash, setFlash] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Track the on-screen video size so the capture frame can be laid out to the
  // historic photo's aspect ratio (and recomputed on rotate/resize).
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
  const pinchStart = useRef<{ zoom: number; dist: number } | null>(null);

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
        // Without resolution hints iOS Safari hands back a tiny 480x640 stream,
        // so captures come out soft. Ask for as much as the device will give
        // (clamped down gracefully via `ideal`) for sharp, keepable photos.
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

  // Returning from the review screen mounts a fresh <video> element, so the
  // live stream has to be re-attached — otherwise it stays black.
  useEffect(() => {
    if (!captured && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [captured]);

  // --- pinch to zoom the camera (two fingers); the ghost stays put ---
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginPinch();
  };
  const beginPinch = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      pinchStart.current = { zoom, dist: Math.hypot(b.x - a.x, b.y - a.y) };
    } else {
      pinchStart.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = pinchStart.current;
    const pts = [...pointers.current.values()];
    if (s && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      setZoom(clampZoom(s.zoom * (dist / (s.dist || 1))));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    beginPinch();
  };

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) {
      setStreamError("Camera frame not ready yet — give it a second.");
      return;
    }
    // The video fills the screen with object-fit: cover and is scaled by `zoom`
    // from its centre. Map the on-screen capture frame back to source pixels and
    // grab exactly that region, so the new photo is the same aspect AND crop as
    // the historic — ready to drop into a before/after slider.
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    // Use LAYOUT dimensions (clientWidth/Height via `box`), NOT
    // getBoundingClientRect — the latter includes the video's CSS zoom transform
    // and would double-count the zoom. .cam is fixed at the viewport origin, so
    // the frame's layout coords are also its screen coords.
    const bw = box.w || window.innerWidth;
    const bh = box.h || window.innerHeight;
    const fr =
      historic && bw && bh
        ? containRect(bw, bh, historic.width / historic.height)
        : { left: 0, top: 0, w: bw, h: bh };
    const coverScale = Math.max(bw / vw, bh / vh);
    const effScale = coverScale * zoom;
    let sx = vw / 2 + (fr.left - bw / 2) / effScale;
    let sy = vh / 2 + (fr.top - bh / 2) / effScale;
    let sw = fr.w / effScale;
    let sh = fr.h / effScale;
    // Keep the source rect inside the frame (guards against edge/zoom rounding).
    sx = Math.max(0, Math.min(sx, vw));
    sy = Math.max(0, Math.min(sy, vh));
    sw = Math.min(sw, vw - sx);
    sh = Math.min(sh, vh - sy);
    const outW = Math.max(1, Math.round(sw));
    const outH = Math.max(1, Math.round(sh));
    const c = document.createElement("canvas");
    c.width = outW;
    c.height = outH;
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
    const diag = `cam ${vw}×${vh} · frame ${Math.round(fr.w)}×${Math.round(
      fr.h
    )} · zoom ${zoom.toFixed(2)}x · out ${outW}×${outH}`;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "rephoto-capture.jpg", {
          type: "image/jpeg",
        });
        setCaptured({ url: URL.createObjectURL(file), file, diag });
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
    // If the device can share files (iOS/Android), use the share sheet — it
    // has "Save Image". If the user cancels, do NOT fall back to a download
    // (that's the confusing "Open in Preview" screen). Only download when
    // there's no share support at all.
    if (nav.share && nav.canShare && nav.canShare({ files: [captured.file] })) {
      try {
        await nav.share({ files: [captured.file], title: "Rephoto capture" });
      } catch {
        /* cancelled or failed — leave the user on the review screen */
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
  const frame =
    historic && box.w > 0
      ? containRect(box.w, box.h, historic.width / historic.height)
      : null;

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
        <p className="cam-review__diag">{captured.diag}</p>
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
      <video
        ref={videoRef}
        className="cam-video"
        style={{ transform: `scale(${zoom})` }}
        playsInline
        autoPlay
        muted
      />

      {/* Capture frame, shaped to the historic photo, with the ghost locked
          inside it. Everything outside is dimmed; the shot is cropped to exactly
          this rect, so the new photo matches the historic's aspect and crop. */}
      {frame && (
        <div
          ref={frameRef}
          className="cam-frame"
          style={{
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.w}px`,
            height: `${frame.h}px`,
          }}
        >
          <img
            className="cam-frame__ghost"
            src={historic!.el.src}
            alt=""
            style={{ opacity }}
            draggable={false}
          />
        </div>
      )}

      <div className="cam-grid" aria-hidden>
        <span /> <span /> <span /> <span />
      </div>

      {/* gesture surface for pinch-to-zoom the camera */}
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

      {/* Thumb controls (only meaningful once a ghost is loaded). Zoom on the
          left (match the old lens), opacity on the right by the shutter. */}
      {historic && (
        <>
          <div className="cam-slider cam-slider--left">
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              aria-label="Camera zoom"
              onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
            />
            <span className="cam-slider__label">zoom</span>
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
