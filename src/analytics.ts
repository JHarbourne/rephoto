// Privacy-friendly, cookieless page analytics via GoatCounter.
// https://www.goatcounter.com/ — no cookies, no PII, no consent banner needed;
// it honours Do Not Track automatically.
//
// Inactive until a site code is configured at build time via VITE_GC_CODE
// (e.g. VITE_GC_CODE=rephoto -> https://rephoto.goatcounter.com). Until then
// this is a no-op and nothing is loaded.
export function initAnalytics(): void {
  const code = __GC_CODE__;
  if (!code) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "//gc.zgo.at/count.js";
  s.setAttribute(
    "data-goatcounter",
    `https://${code}.goatcounter.com/count`
  );
  document.head.appendChild(s);
}
