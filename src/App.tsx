import { useCallback, useEffect, useMemo, useState } from "react";
import CameraOverlay from "./components/CameraOverlay";
import ImagePanel from "./components/ImagePanel";
import PreviewPanel from "./components/PreviewPanel";
import { align, completePairs, minPoints } from "./lib/align";
import {
  buildAlignmentJSON,
  exportAlignmentJSON,
  exportImages,
} from "./lib/export";
import { loadOpenCV } from "./opencv/loadOpenCV";
import type {
  AlignmentResult,
  CropRect,
  LoadedImage,
  Pair,
  PreviewMode,
  Selection,
  Side,
  WarpType,
} from "./types";

let pairCounter = 0;
const nextId = () => `p${++pairCounter}`;

function loadImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      resolve({
        el,
        width: el.naturalWidth,
        height: el.naturalHeight,
        name: file.name,
      });
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    el.src = url;
  });
}

type View = "align" | "camera";

export default function App() {
  const [view, setView] = useState<View>("camera");
  const [cvReady, setCvReady] = useState(false);
  const [historic, setHistoric] = useState<LoadedImage | null>(null);
  const [modern, setModern] = useState<LoadedImage | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [addMode, setAddMode] = useState(true);
  const [warpType, setWarpType] = useState<WarpType>("homography");
  const [result, setResult] = useState<AlignmentResult | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Preview controls.
  const [mode, setMode] = useState<PreviewMode>("slider");
  const [opacity, setOpacity] = useState(0.5);
  const [sliderPos, setSliderPos] = useState(0.5);
  const [blinkSpeed, setBlinkSpeed] = useState(500);
  const [showPoints, setShowPoints] = useState(true);

  useEffect(() => {
    loadOpenCV().then(
      () => setCvReady(true),
      (err) => setError(err instanceof Error ? err.message : String(err))
    );
  }, []);

  const readyCount = useMemo(() => completePairs(pairs).length, [pairs]);
  const need = minPoints(warpType);
  const canAlign = cvReady && !!historic && !!modern && readyCount >= need;

  const doAlign = useCallback(() => {
    if (!historic || !modern) return;
    try {
      const r = align(historic, modern, pairs, { warpType, cubic: true });
      setResult(r);
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [historic, modern, pairs, warpType]);

  // Live preview: recompute automatically (debounced) as points change.
  useEffect(() => {
    if (!canAlign) {
      if (readyCount < need) setResult(null);
      return;
    }
    const id = window.setTimeout(doAlign, 180);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAlign, pairs, warpType, historic, modern]);

  const handleFile = async (side: Side, file: File) => {
    try {
      const img = await loadImageFile(file);
      if (side === "historic") setHistoric(img);
      else setModern(img);
      setResult(null);
      setCrop(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePlace = (side: Side, x: number, y: number) => {
    setPairs((prev) => {
      const other: Side = side === "historic" ? "modern" : "historic";
      const idx = prev.findIndex((p) => !p[side] && p[other]);
      if (idx >= 0) {
        const cp = [...prev];
        cp[idx] = { ...cp[idx], [side]: { x, y } };
        return cp;
      }
      return [...prev, { id: nextId(), [side]: { x, y } }];
    });
  };

  const handleMove = (pairId: string, side: Side, x: number, y: number) => {
    setPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, [side]: { x, y } } : p))
    );
  };

  const handleSelect = (pairId: string, side: Side) => {
    setSelection({ pairId, side });
  };

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    setPairs((prev) =>
      prev
        .map((p) =>
          p.id === selection.pairId ? { ...p, [selection.side]: undefined } : p
        )
        .filter((p) => p.historic || p.modern)
    );
    setSelection(null);
  }, [selection]);

  const resetPoints = () => {
    setPairs([]);
    setSelection(null);
    setResult(null);
    setCrop(null);
    setError(null);
  };

  const autoCrop = () => {
    if (result) setCrop(result.coverage);
  };

  // From the live-camera "ghost overlay" mode: hand the captured frame to the
  // aligner as the modern image. (Saving to Photos is offered in the camera
  // review screen, not forced here.)
  const handleCapture = async (file: File) => {
    try {
      const img = await loadImageFile(file);
      setModern(img);
      setResult(null);
      setCrop(null);
      setError(null);
      setView("align");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, deleteSelected]);

  const onExportImages = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await exportImages(result, crop);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onExportJSON = () => {
    if (!historic || !modern) return;
    const json = buildAlignmentJSON(
      historic,
      modern,
      pairs,
      result,
      crop,
      new Date().toISOString()
    );
    exportAlignmentJSON(json);
  };

  const outputSize = crop
    ? `${Math.round(crop.width)}×${Math.round(crop.height)}`
    : result
    ? `${result.frameWidth}×${result.frameHeight}`
    : "—";

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Rephoto</h1>
          <p>Line up then &amp; now — before/after alignment for walking tours</p>
        </div>
        <div className="view-tabs">
          <button
            className={`chip ${view === "align" ? "active" : ""}`}
            onClick={() => setView("align")}
          >
            Align photos
          </button>
          <button
            className={`chip ${view === "camera" ? "active" : ""}`}
            onClick={() => setView("camera")}
          >
            Camera overlay
          </button>
        </div>
        {!cvReady && <div className="cv-loading">Loading OpenCV…</div>}
      </header>

      {view === "camera" ? (
        <CameraOverlay
          historic={historic}
          onFile={handleFile}
          onCapture={handleCapture}
          onExit={() => setView("align")}
        />
      ) : (
        <>
      <div className="toolbar">
        <label className="btn file-btn">
          Upload historic
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile("historic", f);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <label className="btn file-btn">
          Upload modern
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile("modern", f);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <div className="sep" />

        <button
          className={`btn ${addMode ? "active" : ""}`}
          onClick={() => setAddMode((v) => !v)}
        >
          {addMode ? "Add point mode: ON" : "Add point mode: OFF"}
        </button>
        <button className="btn" onClick={deleteSelected} disabled={!selection}>
          Delete selected point
        </button>
        <div className="sep" />

        <label className="warp-select">
          Warp:
          <select
            value={warpType}
            onChange={(e) => setWarpType(e.target.value as WarpType)}
          >
            <option value="homography">Homography (4+ pts)</option>
            <option value="tps">Thin plate spline (3+ pts)</option>
          </select>
        </label>
        <button className="btn primary" onClick={doAlign} disabled={!canAlign}>
          Align
        </button>
      </div>

      <p className="hint-line">
        Tap the same feature on both photos to add a numbered pair.{" "}
        <strong>Pinch to zoom</strong> for precise placement, drag a point to
        move it, or tap a point then “Delete selected point”.
      </p>

      <div className="status-bar">
        <span>
          Matched pairs: <strong>{readyCount}</strong>
          {readyCount < need && historic && modern && (
            <em>
              {" "}
              (need {need} for {warpType})
            </em>
          )}
        </span>
        {result && (
          <span>
            Alignment error: <strong>{result.rmsError.toFixed(2)} px</strong>
          </span>
        )}
        <span>
          Output size: <strong>{outputSize}</strong>
          {crop ? " (cropped)" : ""}
        </span>
        {error && <span className="err">⚠ {error}</span>}
      </div>

      <main className="editors">
        <ImagePanel
          title="Historic"
          side="historic"
          image={historic}
          pairs={pairs}
          selection={selection}
          showPoints={showPoints}
          addMode={addMode}
          onPlace={handlePlace}
          onSelect={handleSelect}
          onMove={handleMove}
          onFile={handleFile}
        />
        <ImagePanel
          title="Modern"
          side="modern"
          image={modern}
          pairs={pairs}
          selection={selection}
          showPoints={showPoints}
          addMode={addMode}
          onPlace={handlePlace}
          onSelect={handleSelect}
          onMove={handleMove}
          onFile={handleFile}
        />
      </main>

      <section className="preview-section">
        <div className="preview-intro">
          <strong>Aligned preview.</strong> This overlays your two aligned photos
          so you can check the match. <em>Slider</em> wipes between then &amp; now;{" "}
          <em>opacity</em> fades between them; <em>blink</em> flips back and forth
          (great for spotting anything that still jumps).
        </div>
        <div className="preview-controls">
          <div className="mode-group">
            {(["slider", "opacity", "blink"] as PreviewMode[]).map((m) => (
              <button
                key={m}
                className={`chip ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "opacity" && (
            <label className="range">
              Opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
          )}
          {mode === "slider" && (
            <label className="range">
              Before / After
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
              />
            </label>
          )}
          {mode === "blink" && (
            <label className="range">
              Blink speed
              <input
                type="range"
                min={120}
                max={1500}
                step={20}
                value={blinkSpeed}
                onChange={(e) => setBlinkSpeed(Number(e.target.value))}
              />
            </label>
          )}

          <label className="toggle">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
            />
            Show control points
          </label>
        </div>

        <PreviewPanel
          result={result}
          crop={crop}
          mode={mode}
          opacity={opacity}
          sliderPos={sliderPos}
          blinkSpeed={blinkSpeed}
          showPoints={showPoints}
          pairs={pairs}
          onSliderChange={setSliderPos}
        />

        <PointsList
          pairs={pairs}
          selection={selection}
          onSelect={setSelection}
          onDelete={(pairId, side) => {
            setPairs((prev) =>
              prev
                .map((p) => (p.id === pairId ? { ...p, [side]: undefined } : p))
                .filter((p) => p.historic || p.modern)
            );
            setSelection(null);
          }}
        />
      </section>

      <div className="finish-bar">
        <button className="btn" onClick={autoCrop} disabled={!result}>
          Auto crop overlap
        </button>
        <button
          className="btn primary"
          onClick={onExportImages}
          disabled={!result || busy}
        >
          Export images
        </button>
        <button
          className="btn"
          onClick={onExportJSON}
          disabled={!historic || !modern}
          title="A small data file recording your points and the warp — for reproducing or editing the alignment later. Most people won't need it."
        >
          Export alignment JSON
        </button>
        <button className="btn danger" onClick={resetPoints} disabled={!pairs.length}>
          Clear all points
        </button>
      </div>

      <footer className="app-footer">
        Point tips: turn on <strong>Add point mode</strong>, then click the same
        feature (a window corner, roofline, kerb edge) on the historic image and
        again on the modern image to make a numbered pair. Turn Add mode off to
        drag points. Spread 6–10 points across the whole frame for the steadiest
        alignment.
        <span className="app-meta">
          <span>Rephoto v{__APP_VERSION__}</span>
          <a
            href="https://github.com/JHarbourne/rephoto/issues/new"
            target="_blank"
            rel="noopener"
          >
            Suggest an improvement
          </a>
        </span>
      </footer>
        </>
      )}
    </div>
  );
}

function PointsList({
  pairs,
  selection,
  onSelect,
  onDelete,
}: {
  pairs: Pair[];
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onDelete: (pairId: string, side: Side) => void;
}) {
  if (!pairs.length)
    return <div className="points-list empty">No control points yet.</div>;
  return (
    <div className="points-list">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Historic</th>
            <th>Modern</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => {
            const fmt = (side: Side) => {
              const pt = p[side];
              if (!pt) return <span className="missing">—</span>;
              const sel =
                selection?.pairId === p.id && selection?.side === side;
              return (
                <button
                  className={`coord ${sel ? "sel" : ""}`}
                  onClick={() => onSelect({ pairId: p.id, side })}
                >
                  {Math.round(pt.x)}, {Math.round(pt.y)}
                </button>
              );
            };
            return (
              <tr
                key={p.id}
                className={p.historic && p.modern ? "" : "incomplete"}
              >
                <td>{i + 1}</td>
                <td>{fmt("historic")}</td>
                <td>{fmt("modern")}</td>
                <td>
                  {(["historic", "modern"] as Side[])
                    .filter((s) => p[s])
                    .map((s) => (
                      <button
                        key={s}
                        className="mini"
                        title={`Delete ${s} point`}
                        onClick={() => onDelete(p.id, s)}
                      >
                        ✕{s[0]}
                      </button>
                    ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
