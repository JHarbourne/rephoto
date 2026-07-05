// Copies the OpenCV.js runtime out of node_modules into public/ so it is
// served as a standalone script (not bundled). Runs automatically before
// `dev` and `build`. Kept out of git — regenerated from the dependency.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@techstark/opencv-js/dist/opencv.js");
const destDir = resolve(root, "public");
const dest = resolve(destDir, "opencv.js");

if (!existsSync(src)) {
  console.error(
    "[copy-opencv] Could not find OpenCV.js at", src,
    "\nRun `npm install` first."
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-opencv] Copied OpenCV.js runtime to public/opencv.js");
