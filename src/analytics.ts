// Privacy-friendly, cookieless page analytics via Cloudflare Web Analytics.
// https://developers.cloudflare.com/web-analytics/ — no cookies, no PII, no
// consent banner needed.
//
// Inactive until a beacon token is configured at build time via VITE_CF_BEACON
// (grab it from Cloudflare dashboard → Web Analytics → Add a site → the JS
// snippet's `token`). Until then this is a no-op and nothing is loaded.
export function initAnalytics(): void {
  const token = __CF_BEACON__;
  if (!token) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token }));
  document.head.appendChild(s);
}
