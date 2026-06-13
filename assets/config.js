// Runtime config (kept same-origin so a strict Content-Security-Policy can use
// script-src 'self' with no inline scripts). Set this to your deployed backend
// to activate the Coupons & assistance feature; leave empty for the static-only
// build. Overridable per-request with ?api=<base>.
window.OPENRX_API = 'https://openrx-api.onrender.com';
