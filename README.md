# Rephoto

A small browser app for aligning a **modern photograph** to a **historic
photograph** so the pair can be used in a before/after slider — the kind used
in local-history walking tours, where fixed buildings, windows, rooflines and
road edges must not jump when the slider moves.

Everything runs locally in the browser. Images are never uploaded to a server,
and the modern photograph's pixels are only ever *geometrically* resampled to
match the historic viewpoint — colours and content are never altered unless you
explicitly choose an enhancement.

## Two ways to use it

- **Align photos** — the desktop-style workflow: upload a historic and a modern
  photo, mark matching points, warp, preview, export.
- **Camera overlay** — a live "rephotography" mode for your phone: hold the
  camera up to the scene with the historic photo ghosted on top, physically line
  up a fixed edge (roofline, window, kerb), and capture. The captured frame
  drops straight into the aligner for a pixel-perfect finish. This is the most
  accurate way to shoot a matching modern photo, because you fix the framing at
  capture time instead of warping it afterward.

It is a **PWA** — you can install it to your phone's home screen and it works
offline once loaded (the OpenCV runtime is cached), which is handy out on a
walking tour with poor signal.

## Features

- Upload a historic and a modern image (button or drag-and-drop).
- Side-by-side canvases for placing **matched control-point pairs**.
- Points are numbered, selectable, draggable, and individually deletable.
- Live preview overlay with three modes:
  - **slider** — drag a before/after wipe,
  - **opacity** — cross-fade with a slider,
  - **blink** — auto-toggle between the two at an adjustable speed.
- Show/hide control points on every canvas.
- Two warp models:
  - **Homography** (needs 4+ points) — a single projective transform. Robust,
    great for flat façades photographed from a similar spot. Uses RANSAC when
    more than four points are given so a single mis-click can't wreck the fit.
  - **Thin plate spline** (needs 3+ points) — a smooth non-linear mesh warp
    that locks many features in place at once; better when the two viewpoints
    differ enough that one plane isn't sufficient.
- **Auto crop overlap** — crop both images to the region the warped modern
  image actually covers, so the exported pair share identical dimensions.
- Exports:
  - `historic_aligned.jpg`
  - `modern_aligned.jpg`
  - `alignment.json` — control points, the warp matrix, crop rect and the
    reprojection error, so an alignment can be inspected or reproduced.

## Tech

- React + TypeScript + Vite.
- HTML canvas for display and point selection.
- `getUserMedia` for the live camera overlay (rear camera, needs an https page).
- [OpenCV.js](https://docs.opencv.org/master/df/d0a/tutorial_js_intro.html)
  (`@techstark/opencv-js`) for `findHomography` / `warpPerspective`, and
  `remap` for the thin-plate-spline mesh warp.
- `vite-plugin-pwa` for the installable, offline-capable PWA (Workbox service
  worker precaches the app shell + the OpenCV runtime).

### How OpenCV.js is loaded

OpenCV.js is a ~10 MB Emscripten runtime. Rather than bundling it into the app
chunk (which bloats the bundle and breaks the runtime's initialisation), it is
copied out of `node_modules` into `public/opencv.js` by `scripts/copy-opencv.mjs`
(run automatically on `postinstall`, `predev` and `prebuild`) and loaded from a
`<script>` tag at runtime. The npm package is kept as a dependency for its
TypeScript types only.

## Getting started

```sh
npm install      # also copies the OpenCV.js runtime into public/
npm run dev      # start the dev server
npm run build    # type-check and build to dist/
npm run preview  # preview the production build
```

Then open the dev server URL it prints.

## On your phone (camera overlay + install)

The app is hosted at **https://jharbourne.github.io/rephoto/** (via the
GitHub Actions workflow in this repo). On your phone:

1. Open that URL in Safari (iOS) or Chrome (Android).
2. **Install it**: iOS → Share → *Add to Home Screen*; Android → menu →
   *Install app*. It then launches full-screen with its own icon and works
   offline.
3. Open the **Camera overlay** tab, load the historic photo, and allow camera
   access when prompted. Drag the ghost to move it, pinch to zoom/rotate, adjust
   opacity, line up a fixed edge, and **Capture**. The shot lands in the
   aligner tab for the fine-tune, and a copy downloads to your device.

The camera needs a secure (https) page — the hosted site qualifies; a plain
`http://` address will not grant camera access.

### Deploying your own copy

`.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages
on every push to `main`. Enable it once under repo **Settings → Pages → Source
→ GitHub Actions**. The build sets `VITE_BASE` to the repo's sub-path
(`/rephoto/`) so the PWA scope and asset URLs resolve correctly; change it if
you deploy under a different path.

## Workflow

1. **Upload historic** and **Upload modern**.
2. With **Add point mode** on, click a distinctive fixed feature (a window
   corner, a roofline peak, a kerb edge) on the historic image, then click the
   same feature on the modern image. That makes one numbered pair. Repeat for
   6–10 features spread across the whole frame for the steadiest result.
3. Turn Add mode off to **drag** points, or select one and press
   **Delete selected point** (or the <kbd>Delete</kbd> key).
4. Pick a warp (start with **Homography**) and press **Align**. The preview
   updates automatically as you refine points.
5. Use the preview modes to check that fixed features hold still.
6. **Auto crop overlap**, then **Export images** and **Export alignment JSON**.

## Tips for museum-quality results

- Prefer points on genuinely rigid, permanent structure (masonry, window
  frames, kerbs) — not on things that move or grow (foliage, parked cars,
  signage).
- Spread points to the frame's corners; clustered points leave the edges free
  to swing.
- If a flat homography can't hold every feature (because the viewpoints differ),
  switch to **Thin plate spline** and add a few more points where drift remains.
- Watch the reported reprojection error — a lower number means the points are
  mutually consistent.
