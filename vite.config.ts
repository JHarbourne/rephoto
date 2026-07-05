import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

// Minimal ambient declaration so we can read the build-time env var without
// pulling @types/node into the app's type context.
declare const process: { env: Record<string, string | undefined> };

// GitHub Pages serves this project from a sub-path (/docker-wpcomvip/). The CI
// build sets VITE_BASE so asset URLs and the service-worker scope are correct;
// local dev/preview default to "/".
const base = process.env.VITE_BASE || "/";

// https://vitejs.dev/config/
export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "opencv.js"],
      manifest: {
        name: "Rephoto",
        short_name: "Rephoto",
        description:
          "Line up a modern photo with a historic one for before/after walking-tour sliders, with a live camera ghost overlay.",
        theme_color: "#14161a",
        background_color: "#14161a",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell + the ~10 MB OpenCV runtime so the tool works
        // offline once loaded — handy out on a walking tour with no signal.
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
