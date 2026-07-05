# Rephoto — Functional Specification Document

**Status:** Living document · **Last updated:** 2026-07-05 · **Version:** 0.2

Rephoto is a browser-based **photo aligner**. It takes two photographs of the
same place — typically an old ("historic") photo and a present-day ("modern")
one — and lines them up so the pair can drive a before/after slider, cross-fade
or blink comparison. Everything runs client-side; no image ever leaves the
device.

---

## 1. Purpose & scope

### 1.1 Problem

A convincing before/after comparison needs the two images to share the same
viewpoint and framing, so fixed edges — rooflines, window frames, kerbs — hold
still as the slider wipes across. Two photos taken decades apart almost never
match: the camera stood in a slightly different spot, at a different focal
length, at a different height. Rephoto closes that gap in two complementary
ways.

### 1.2 In scope

- **Camera Overlay ("rephotography") mode** — a live mobile capture flow that
  ghosts the historic photo over the camera feed so the user can physically
  line up the scene and shoot a matching frame.
- **Align mode** — a point-based desktop-style workflow that warps a supplied
  modern photo onto the historic one using matched control points.
- **Export** of the aligned pair plus a machine-readable alignment record.
- Installable, offline-capable **PWA** delivery.

### 1.3 Out of scope

- Server-side storage, accounts, or sharing of images.
- Colour grading, retouching or content edits (geometry only).
- Multi-image panoramas or 3-D reconstruction.

---

## 2. Users & use cases

| User | Goal |
|---|---|
| Local-history / heritage volunteer | Build "then and now" pairs for a walking tour or archive. |
| Museum / gallery curator | Produce museum-quality, dimension-matched before/after assets. |
| Property / restoration / construction | Document a building across a project or restoration. |
| Naturalist / hobbyist | Track a landscape across seasons, weather, or years. |

The **Camera Overlay** mode targets someone standing at the scene with a phone;
**Align mode** targets someone at a desk with two existing image files.

---

## 3. Functional requirements

### 3.1 Camera Overlay mode (default tab)

- **FR-C1** On opening, the app shows the Camera tab by default.
- **FR-C2** The user taps **Load historic photo** and grants camera access; the
  rear camera (`facingMode: environment`) fills the screen.
- **FR-C3** The historic photo is shown as a movable ghost, locked into a frame
  shaped like the historic image's aspect ratio, over the live feed.
- **FR-C4** Gestures: drag to reposition the ghost; pinch to scale it
  (clamped 0.2×–5×). A **size** slider (logarithmic, centred at 100%) and an
  **opacity** slider give fine control without occluding the shutter.
- **FR-C5** The shutter captures the current frame. The capture is **cropped to
  the historic photo's aspect ratio and to the ghost's on-screen box**, so the
  two images come out the same shape — a matched pair.
- **FR-C6** Capture is requested at high resolution (ideal 3840×2160) to avoid
  the soft, low-res default stream on iOS Safari.
- **FR-C7** A review screen shows the captured frame beside the historic photo,
  with actions: **Save to Photos**, **Use in aligner** (hands the capture to
  Align mode), and **＋ Take another** (returns to live camera for the next
  shot without reloading the app).
- **FR-C8** Retaking must re-attach the live stream to the camera element (no
  black screen).

### 3.2 Align mode

- **FR-A1** Upload a historic and a modern image (file picker or drag-and-drop).
- **FR-A2** Place **matched control-point pairs**: click a fixed feature on the
  historic image, then the same feature on the modern image. Points are
  numbered, selectable, draggable and individually deletable.
- **FR-A3** Two warp models:
  - **Homography** (4+ points) — single projective transform; uses RANSAC above
    four points so one mis-click can't wreck the fit.
  - **Thin plate spline** (3+ points) — smooth non-linear mesh warp for
    viewpoints too different for a single plane.
- **FR-A4** Live preview overlay with three modes: **slider** (before/after
  wipe), **opacity** (cross-fade) and **blink** (auto-toggle at adjustable
  speed). Control points can be shown or hidden per canvas.
- **FR-A5** **Auto crop overlap** trims both images to the region the warped
  modern image actually covers, so the exported pair share identical
  dimensions.
- **FR-A6** Report the mean reprojection (RMS) error so the user can judge how
  mutually consistent the points are.

### 3.3 Export

- **FR-E1** Export `historic_aligned.jpg` and `modern_aligned.jpg`, identical in
  size.
- **FR-E2** Export `alignment.json` (`app: "photo-aligner"`) capturing control
  points, warp type and matrix, crop rect, output size and RMS error, so an
  alignment can be inspected or reproduced. See `src/types.ts` →
  `AlignmentJSON`.

### 3.4 PWA & offline

- **FR-P1** Installable to the home screen (iOS: Share → Add to Home Screen;
  Android: Install app), launching full-screen with its own icon.
- **FR-P2** Works offline once loaded — Workbox precaches the app shell and the
  OpenCV runtime.

---

## 4. Non-functional requirements

- **Privacy** — images are processed entirely in the browser and never
  uploaded. Only *geometric* resampling is applied; pixels' colour/content are
  never altered unless the user opts into an enhancement.
- **Analytics privacy** — Cloudflare Web Analytics only: cookieless, no
  localStorage, aggregate page views. No consent banner required under UK PECR /
  GDPR. No Google Analytics, no PostHog, no advertising trackers.
- **Security** — the camera requires a secure (https) origin, which the hosted
  site provides.
- **Performance** — high-res capture and OpenCV warps run acceptably on a
  current mobile browser; the ~10 MB OpenCV runtime is cached after first load.
- **Compatibility** — modern Safari (iOS) and Chrome (Android/desktop). Camera
  Overlay depends on `getUserMedia` with a rear camera.

---

## 5. Technical architecture

### 5.1 Stack

- **React 18 + TypeScript + Vite** (SPA).
- **OpenCV.js** (`@techstark/opencv-js`) — `findHomography` / `warpPerspective`
  for the projective warp, `remap` for the thin-plate-spline mesh warp.
- **HTML canvas** for display, point selection and compositing.
- **`getUserMedia`** for the live camera overlay.
- **`vite-plugin-pwa`** (Workbox) for the installable, offline PWA.

### 5.2 OpenCV.js loading

OpenCV.js is a ~10 MB Emscripten runtime. Rather than bundle it into the app
chunk (which bloats the build and breaks the runtime's initialisation), it is
copied from `node_modules` into `public/opencv.js` by
`scripts/copy-opencv.mjs` (run on `postinstall`, `predev`, `prebuild`) and
loaded via a `<script>` tag at runtime. The npm package is kept as a dependency
for its TypeScript types only.

### 5.3 Source map

| Path | Responsibility |
|---|---|
| `src/App.tsx` | Tab shell (Camera / Align), shared state. |
| `src/components/CameraOverlay.tsx` | Live camera, ghost overlay, gestures, capture/crop, review screen. |
| `src/components/ImagePanel.tsx` | Per-image canvas with control-point placement. |
| `src/components/PreviewPanel.tsx` | Slider / opacity / blink preview. |
| `src/lib/align.ts` | Homography solve + warp orchestration. |
| `src/lib/tps.ts` | Thin-plate-spline mesh warp. |
| `src/lib/export.ts` | JPEG + `alignment.json` export. |
| `src/opencv/loadOpenCV.ts` | Runtime loader / ready gate. |
| `src/analytics.ts` | Cloudflare Web Analytics beacon. |
| `src/types.ts` | Shared types incl. `AlignmentJSON`. |

### 5.4 Hosting

- **Platform:** GitHub Pages, published by the GitHub Actions workflow
  (`.github/workflows/deploy.yml`) on every push to `main`, with a one-shot
  retry to ride out GitHub's occasional transient publish failures.
- **Domain:** custom subdomain **`rephoto.nearmark.co.uk`**, set via
  `public/CNAME`, with a DNS record `CNAME rephoto → jharbourne.github.io`. The
  build base is `/` because the app is served at the domain root
  (`VITE_BASE` override available for repo sub-path hosting).

### 5.5 Analytics

- **Cloudflare Web Analytics** — cookieless beacon (`beacon.min.js`). The token
  is public by design (it ships in the client), so it is baked in as the default
  in `vite.config.ts`; `VITE_CF_BEACON` overrides it (blank = analytics off).
  Pageview-only: no custom events, no per-visitor data.

---

## 6. Workflow (Align mode reference)

1. Upload **historic** and **modern**.
2. With **Add point mode** on, click a fixed feature (window corner, roofline
   peak, kerb edge) on the historic image, then the same feature on the modern
   image. Repeat for 6–10 features spread across the frame.
3. Turn Add mode off to drag points, or select and delete.
4. Pick a warp (start with **Homography**) and press **Align**; the preview
   refreshes as points change.
5. Use the preview modes to confirm fixed features hold still.
6. **Auto crop overlap**, then **Export images** and **Export alignment JSON**.

---

## 7. Open items / future

- Change the backing Cloudflare/analytics and related accounts off the original
  Capgemini email to the personal account (tracked separately).
- Potential rename of the descriptor was considered and deferred; the app is a
  general **photo aligner**, not historic-only.
