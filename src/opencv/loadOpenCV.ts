import type * as CV from "@techstark/opencv-js";

/**
 * OpenCV.js type surface. We import the package for its TYPES only (the
 * `import type` is erased at build time). The actual runtime is loaded from a
 * `<script>` tag wired up in index.html during initial page parse — see the
 * comment there for why it must load before the React app starts.
 */
export type OpenCV = typeof CV;

declare global {
  interface Window {
    cv?: OpenCV;
    __openCvError?: string;
    __openCvReady?: boolean;
  }
}

let readyPromise: Promise<void> | null = null;

function isReady(): boolean {
  const cv = window.cv;
  return (
    !!cv &&
    typeof cv.Mat === "function" &&
    typeof cv.imread === "function" &&
    typeof cv.findHomography === "function"
  );
}

/**
 * Resolve once the OpenCV.js runtime has finished initialising. The runtime is
 * loaded by index.html; here we just poll for its API surface to appear.
 *
 * NOTE: this resolves with `void`, never with the `cv` object. The emscripten
 * Module exposes a `then` method (so it can be awaited), which makes it a
 * "thenable"; resolving a Promise with it would make the microtask machinery
 * invoke `cv.then(...)` and drive the runtime into a state that pins the main
 * thread. Consumers should read the runtime synchronously via `getCV()`.
 */
export function loadOpenCV(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    if (isReady()) {
      resolve();
      return;
    }

    const poll = window.setInterval(() => {
      if (window.__openCvError) {
        window.clearInterval(poll);
        reject(new Error(window.__openCvError));
        return;
      }
      if (isReady()) {
        window.clearInterval(poll);
        resolve();
      }
    }, 50);
  });

  return readyPromise;
}

/** Synchronously get the OpenCV runtime. Only valid after loadOpenCV resolves. */
export function getCV(): OpenCV {
  const cv = window.cv;
  if (!cv) throw new Error("OpenCV.js is not loaded yet");
  return cv;
}
