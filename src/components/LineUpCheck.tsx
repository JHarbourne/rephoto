import { useRef, useState } from "react";
import type { LoadedImage } from "../types";
import { viewpointHint, type FacePins, type Frac } from "../lib/viewpoint";

interface Props {
  historic: LoadedImage;
  /** Freeze the current camera frame; returns its data URL (or null). */
  grabFrame: () => { url: string } | null;
  onClose: () => void;
}

const DEFAULT_PINS: FacePins = {
  corner: { x: 0.5, y: 0.5 },
  left: { x: 0.22, y: 0.55 },
  right: { x: 0.78, y: 0.55 },
};

const KEYS: (keyof FacePins)[] = ["left", "corner", "right"];
const LABEL: Record<keyof FacePins, string> = {
  corner: "C",
  left: "L",
  right: "R",
};

/** One image with three draggable pins the user positions on the features. */
function PinImage({
  src,
  pins,
  onChange,
  caption,
}: {
  src: string;
  pins: FacePins;
  onChange: (p: FacePins) => void;
  caption: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<keyof FacePins | null>(null);

  const moveTo = (k: keyof FacePins, clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const p: Frac = {
      x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
    };
    onChange({ ...pins, [k]: p });
  };

  return (
    <figure className="lc-imgwrap">
      <figcaption className="lc-cap">{caption}</figcaption>
      <div className="lc-img" ref={boxRef}>
        <img src={src} alt={caption} draggable={false} />
        {KEYS.map((k) => (
          <button
            key={k}
            className={`lc-pin lc-pin--${k}`}
            style={{ left: `${pins[k].x * 100}%`, top: `${pins[k].y * 100}%` }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              dragging.current = k;
            }}
            onPointerMove={(e) => {
              if (dragging.current === k) moveTo(k, e.clientX, e.clientY);
            }}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
            aria-label={`${caption} ${LABEL[k]} pin`}
          >
            {LABEL[k]}
          </button>
        ))}
      </div>
    </figure>
  );
}

/**
 * On-demand check that tells you which way to step so your viewpoint matches
 * the old photo's. Deliberately manual (mark the corner + both face edges on
 * each photo) rather than auto-matching, which isn't reliable between a faded
 * historic photo and a live sunlit scene.
 */
export default function LineUpCheck({ historic, grabFrame, onClose }: Props) {
  const [histPins, setHistPins] = useState<FacePins>(DEFAULT_PINS);
  const [snap, setSnap] = useState<string | null>(null);
  const [livePins, setLivePins] = useState<FacePins>(DEFAULT_PINS);

  const grab = () => {
    const f = grabFrame();
    if (f) {
      setSnap(f.url);
      setLivePins(DEFAULT_PINS);
    }
  };

  const hint = snap ? viewpointHint(histPins, livePins) : null;
  const arrow =
    hint?.axis === "left" ? "←" : hint?.axis === "right" ? "→" : "✓";
  const text = !hint
    ? ""
    : hint.axis === "ok"
    ? "Left / right looks good"
    : `Step ${hint.axis === "left" ? "LEFT" : "RIGHT"}${
        hint.strength < 0.4 ? " a little" : ""
      }`;

  return (
    <div className="lc">
      <div className="lc-head">
        <strong>Line-up check</strong>
        <button className="cam-chip" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="lc-note">
        Drag <b>C</b> to the building’s near corner and <b>L</b>/<b>R</b> to the
        outer edge of each face — the same features on both photos. It compares
        how much of each face you can see and tells you which way to step.
        Left/right only for now.
      </p>

      <div className="lc-grid">
        <PinImage
          src={historic.el.src}
          pins={histPins}
          onChange={setHistPins}
          caption="Old photo (target)"
        />
        {snap ? (
          <PinImage
            src={snap}
            pins={livePins}
            onChange={setLivePins}
            caption="Your view"
          />
        ) : (
          <div className="lc-imgwrap lc-grab">
            <button className="cam-btn strong" onClick={grab}>
              Grab current view
            </button>
            <span className="lc-grabhint">
              Freeze the camera so you can place the pins without chasing a
              moving picture.
            </span>
          </div>
        )}
      </div>

      {hint && (
        <div className={`lc-result lc-result--${hint.axis}`}>
          <div className="lc-verdict">
            <span className="lc-arrow">{arrow}</span>
            <span className="lc-text">{text}</span>
          </div>
          <div className="lc-bar" aria-hidden>
            <span
              className="lc-bar__tick lc-bar__target"
              style={{ left: `${hint.balanceTarget * 100}%` }}
            />
            <span
              className="lc-bar__tick lc-bar__now"
              style={{ left: `${hint.balanceNow * 100}%` }}
            />
          </div>
          <div className="lc-legend">
            <span>
              <i className="lc-dot lc-dot--target" /> old photo
            </span>
            <span>
              <i className="lc-dot lc-dot--now" /> your view
            </span>
            <button className="cam-chip" onClick={grab}>
              Re-grab view
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
