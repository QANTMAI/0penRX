# Frontend hosting migration — GitHub Pages → header-capable host

**Why:** GitHub Pages fundamentally cannot serve real HTTP response headers, so
the frontend cannot deliver HSTS, `X-Frame-Options`, `Permissions-Policy`, COOP,
or a CSP with `frame-ancestors`/reporting (all verified `<meta>`-ignored — see
`docs/SECURITY_PLAN_2026.md`). Moving to a host that reads a `_headers` file
closes the entire gap in one move and also gives edge post-quantum TLS, HTTP/3,
and AI-bot controls.

The `_headers` file at the repo root is already written with the OWASP 2026
baseline. It is **inert on GitHub Pages** and **activates automatically** on the
hosts below — no code changes needed, just re-point the deploy.

## Recommended: Cloudflare Pages

Chosen because it manages its own TLS at the edge, so it **avoids the
GitHub-Pages-cert-renewal conflict** that a Cloudflare *proxy* in front of Pages
causes (documented in `docs/SEO_INDEXNOW_PLAYBOOK.md`).

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
   select `QANTMAI/0penRX`.
2. Build settings: **Framework preset = None**, **Build command = (empty)**,
   **Build output directory = `/`** (the site is pre-built static HTML).
3. Deploy. Cloudflare serves the site from the repo root and reads `_headers`
   automatically.
4. **Custom domain:** Pages project → **Custom domains → Set up `0penrx.org`**.
   Cloudflare provisions + auto-renews the cert (no ACME conflict since the origin
   is Cloudflare Pages, not GitHub).
5. **DNS:** point `0penrx.org` (and `www`) at the Pages project (Cloudflare adds the
   records). Remove the old GitHub Pages `A`/`CNAME` records and the repo's `CNAME`
   file once cutover is verified.
6. Turn on **Speed → Protocol Optimization → HTTP/3** and confirm **SSL/TLS =
   Full (strict)** (valid since Cloudflare owns the cert end-to-end here).
7. Verify: `curl -sI https://0penrx.org | grep -iE 'strict-transport|x-frame|content-security|permissions-policy'`
   should now show the headers. Run the URL through
   [securityheaders.com](https://securityheaders.com) and
   [MDN Observatory](https://developer.mozilla.org/observatory) — target A+.

## Alternative: Netlify (identical `_headers` support)

`New site from Git` → select the repo → **Publish directory = `/`**, no build
command → add the custom domain (Netlify manages TLS). Same `_headers` file.

## After cutover

- Delete the `CNAME` file and disable GitHub Pages (Settings → Pages) to avoid two
  live origins.
- Add `; preload` to HSTS in `_headers` and submit to
  [hstspreload.org](https://hstspreload.org) **only** when ready for that
  hard-to-reverse commitment.
- Add a **CAA** DNS record for the new issuer (Cloudflare/Let's Encrypt) and enable
  DNSSEC (Cloudflare is one-click).
- Keep the external cert-expiry/uptime monitor pointed at the new origin.
- The IndexNow key file, `/.well-known/security.txt`, `robots.txt`, `sitemap.xml`,
  and the 86 `/drugs/<slug>/` pages all move unchanged (they're static files).
