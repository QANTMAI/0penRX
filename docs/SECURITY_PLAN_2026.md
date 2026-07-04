# 0penRX — Security Audit & Plan (2026 → 2027+)

A code-grounded security audit of 0penRX, benchmarked against 2026 industry
standards (OWASP, MDN, W3C, IETF, NIST, CA/Browser Forum) with a forward plan for
2027 and beyond. Every standard cited was verified against primary sources in
June 2026.

**Stack:** static frontend on GitHub Pages (custom domain `0penrx.org`, HTTPS) +
read-only FastAPI backend on Render. **No accounts, no user data, no database, no
payments.** That profile makes most auth/session/CSRF/cookie standards N/A and
makes header, transport, CSP, supply-chain, disclosure, and privacy standards the
whole game.

**Overall posture: strong.** The audit found no exploitable vulnerabilities —
universal `esc()` on every DOM sink, tight meta-CSP, CORS locked to the prod
origin, no secrets in the repo, SHA-pinned Actions, a service worker that never
caches cross-origin responses, and zero analytics/trackers. The gaps are hardening
items and one architectural constraint (below).

---

## 1. The one architectural constraint that shapes everything

**GitHub Pages cannot set arbitrary HTTP response headers, and `<meta http-equiv>`
only delivers a *subset* of CSP.** Verified against MDN + the WHATWG pragma-directive
list: the following **cannot** be delivered on bare GitHub Pages —

- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options` **and** CSP `frame-ancestors` (both clickjacking controls)
- `X-Content-Type-Options`, `Permissions-Policy`
- `Cross-Origin-Opener-Policy` / `-Embedder-Policy` / `-Resource-Policy`
- CSP `report-to` / `report-uri` / `sandbox`, and report-only CSP

Only a partial `<meta>` CSP and `<meta name="referrer">` work from HTML alone —
both of which 0penRX already sets.

**Resolution (the single highest-leverage move):** move the static frontend to a
host that serves real headers. Options, best-fit first:

| Option | Headers | TLS | Notes |
|---|---|---|---|
| **Cloudflare Pages** (recommended) | `_headers` file | edge-managed (no cert conflict) | also gives edge PQC, HTTP/3, AI-bot controls, and IndexNow Crawler Hints |
| **Netlify / Vercel** | `_headers` / `vercel.json` | managed | equivalent |
| Cloudflare **proxy in front of GitHub Pages** | Transform Rules | ⚠️ **conflicts with GitHub Pages cert renewal** (see `docs/SEO_INDEXNOW_PLAYBOOK.md`) | avoid — the proxy breaks GitHub's ACME renewal |

The backend (Render/FastAPI) already *can* set real headers — done in Phase 0.

---

## 2. Audit findings & disposition

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | Med | JSON-LD emitted via `json.dumps` into `<script>` — didn't escape `</script>`/`&` (latent XSS if catalog text ever contained them) | ✅ **Fixed** (Phase 0) — both builders now escape `<`,`>`,`&` |
| 2 | Med | Real HTTP security headers absent on the Pages frontend (HSTS, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, COOP) | ⏳ **Phase 1** — needs a header-capable host |
| 3 | Low | CodeQL runs `workflow_dispatch` only (private repo, no free code scanning) — SAST never gates a PR | ⏳ **Phase 2** — re-enable on push/PR when repo goes public |
| 4 | Low | `404.html` had no CSP | ✅ **Fixed** (Phase 0) — locked-down `default-src 'none'` CSP added |
| 5 | Info | `style-src 'unsafe-inline'` (numeric inline widths only) | Accepted — script-src is the hard line; style unsafe-inline is a defensible 2026 posture |
| 6 | Info | GoodRx proxy error interpolated `{exc}` (could stringify the key-bearing URL) | ✅ **Fixed** (Phase 0) — generic messages, no `{exc}` |

**Verify-externally (not checkable from code):** GitHub Pages "Enforce HTTPS" on;
DNS **CAA** + **DNSSEC**; Render env vars (CORS not `*`, GoodRx/openFDA keys set);
add `/.well-known/security.txt` ✅ done.

**Confirmed clean:** XSS/DOM injection, SSRF (GoodRx base URL is env-fixed, user
input is query-only), ReDoS (`re.escape`), CORS, secrets, service-worker caching,
privacy/PII.

---

## 3. Phased plan

### Phase 0 — Quick-win hardening (DONE, in this change)
- JSON-LD injection escaping in both page builders (+ regenerated 86 pages).
- `404.html` locked-down CSP + referrer policy.
- **Backend security headers** via Starlette middleware — the OWASP 2026 baseline
  on every API response (`Strict-Transport-Security: max-age=63072000; includeSubDomains`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'`,
  `Permissions-Policy` deny-list, `Cache-Control: no-store`) + `Server` stack hidden.
  Locked in by `test_security_headers_present`.
- `/.well-known/security.txt` (RFC 9116) pointing at the GitHub advisory process.
- GoodRx proxy error messages no longer echo exceptions (key-leak path closed).

### Phase 1 — Close the header gap + supply-chain table stakes (near-term)
1. **Migrate the static frontend to Cloudflare Pages (or Netlify)** and ship a
   `_headers` file with the full 2026 A+ set (values from OWASP Secure Headers,
   verified 2026-06-30):
   ```
   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://rxnav.nlm.nih.gov https://api.fda.gov https://data.medicaid.gov https://clinicaltables.nlm.nih.gov https://openrx-api.onrender.com; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Resource-Policy: same-origin
   ```
   (Only add HSTS `preload` after confirming all subdomains are HTTPS and you're
   ready for the [hstspreload.org](https://hstspreload.org) permanence. Do **not**
   set `Cross-Origin-Embedder-Policy: require-corp` — it breaks nothing here but
   provides no benefit and can block future third-party assets.)
   ✅ **The `_headers` file and `docs/HOSTING_MIGRATION.md` are now committed** — the
   migration is scaffolded and ready; the cutover itself needs the Cloudflare/Netlify
   account (a `(B)` infra action).
2. ✅ **Least-privilege workflow tokens** — **done**. Every workflow declares
   `permissions:` (`contents: read`, except `coupons.yml` which needs `contents: write`
   and `codeql.yml` which needs `security-events: write`). Actions are SHA-pinned.
3. ✅ **Rate-limit the FastAPI backend** — **done**. Dependency-free per-IP sliding
   window (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`, default 120/60s), 429 + `Retry-After`,
   `/health` exempt for uptime probes. Locked by `test_rate_limiting`.
4. **DNS hardening** (external): add a **CAA** record (after confirming the current
   issuer — GitHub Pages/Render use Let's Encrypt; an over-tight CAA breaks
   auto-renewal), enable **DNSSEC** only if the provider is one-click, and publish
   anti-spoofing records even though we send no mail:
   `MX 0 "."` (null-MX) · `TXT "v=spf1 -all"` · `_dmarc … p=reject`.
5. **External cert-expiry + uptime monitor** (UptimeRobot/cron-job.org) — managed
   renewal can fail silently; this is the safety net as cert lifetimes shrink (§4).

### Phase 2 — 2026 completeness (repo is now PUBLIC — most items done)
- ✅ **CodeQL on push/PR** — **done**. Activated in `codeql.yml`; runs Python +
  JavaScript analysis on every push/PR to `main` + weekly. Closes the SAST gap.
- ✅ **Secret scanning + push protection + private vulnerability reporting** — **done**
  (enabled via the repo Security settings once public; free on public repos).
- ✅ **SBOM in CI** — **done**. `.github/workflows/sbom.yml` (CycloneDX via `cyclonedx-py`).
- ✅ **SLSA build attestation** — **done**. `.github/workflows/release-attest.yml` builds
  the deployable site tarball + SBOM on release and produces keyless SLSA Build L2
  provenance (GitHub OIDC + Sigstore, public Rekor log). Verify:
  `gh attestation verify openrx-site.tar.gz -R QANTMAI/0penRX`.
- **`nonce` CSP — not applicable to this site (documented, intentional).** Nonces /
  `'strict-dynamic'` exist to safely allow *inline* or *third-party* scripts. 0penRX
  has **zero inline scripts and zero third-party scripts** — every script is
  same-origin, so `script-src 'self'` is already the strict policy and a nonce would
  add complexity for no security gain. (`style-src 'unsafe-inline'` covers dynamic
  numeric width attributes; securityheaders.com stopped penalizing style-inline in
  2023.) If a header-capable host is adopted, add CSP **reporting** (`report-to` +
  `Reporting-Endpoints`) — the one reporting feature `<meta>` can't deliver.
- **SSH commit signing** — a **per-developer machine** action (cannot be done in the
  repo). Each contributor, once: `ssh-keygen -t ed25519 -f ~/.ssh/git-signing`, add
  the public key as a *Signing key* in GitHub → Settings → SSH keys, then
  `git config --global gpg.format ssh` + `git config --global user.signingkey ~/.ssh/git-signing.pub`
  + `git config --global commit.gpgsign true`. Yields the native "Verified" badge.
- **OpenSSF Scorecard action** — optional self-audit scoreboard (target 7+); free on
  public repos, low effort.

> **Genuinely can't be code-completed (need an external account):** the **frontend
> header cutover** — moving off GitHub Pages to Cloudflare Pages / Netlify — is the
> only real HTTP-header path (`<meta>` can't set HSTS/X-Frame-Options/Permissions-
> Policy/COOP). It is fully **scaffolded** (`_headers` + `docs/HOSTING_MIGRATION.md`);
> executing it needs a Cloudflare/Netlify login + DNS access. Nothing else is gated.

### Phase 3 — 2027+ watch list (mostly inherited from platforms)
- **Post-quantum TLS**: hybrid **X25519MLKEM768** key exchange is already default in
  Chrome/Firefox/Safari/Edge and served by Cloudflare — you *inherit* it by hosting
  behind a PQC-enabled edge. Matters now because of **"harvest-now-decrypt-later."**
  **PQ certificates** (ML-DSA / Merkle Tree Certs) are experimental — first pilots
  2026, broad trust unlikely before 2027. **Watch, don't act.**
- **Shrinking cert lifetimes** (CA/Browser Forum SC-081v3): 200-day now → 100-day
  (Mar 2027) → 47-day (Mar 2029). **Managed by GitHub Pages/Render/Cloudflare** — the
  only real risk is DNS drift silently breaking auto-renewal, which Phase-1 monitoring
  catches.
- **Web Bot Auth** (IETF `draft-meunier-web-bot-auth`, on RFC 9421 HTTP Message
  Signatures) — cryptographic bot verification; you'll likely inherit it from
  Cloudflare rather than implement it.
- **Trusted Types** (`require-trusted-types-for 'script'`) — Baseline 2026; adopt
  only if client-side JS grows substantially (marginal benefit for a mostly-static app).

---

## 4. Privacy — "collect nothing" is the control (health-data note)

0penRX collects no personal data, sets no cookies, runs no analytics or third-party
pixels, and self-hosts fonts — so ~every affirmative US privacy obligation is simply
**not triggered** (state laws have processing thresholds; no data = no threshold).

**The one latent risk, because the subject matter is prescriptions:** Washington's
**My Health My Data Act (MHMDA)** protects non-HIPAA consumer health data and has
**no size threshold**, and the FTC **Health Breach Notification Rule** treats
tracking-pixel disclosures as reportable breaches. Neither is triggered today, but
they would be the instant drug/condition identifiers land in logs or analytics.
**Design rule: keep drug names / search terms / condition-revealing paths out of any
server log or analytics, and never add a third-party pixel.** A short, honest
"we collect nothing" privacy statement is the highest-value document to add.

---

## 5. Scorecard against 2026 A+ header baseline

| Control | Frontend (Pages today) | Frontend (after Phase 1) | Backend (now) |
|---|---|---|---|
| HSTS | ❌ (Pages can't) | ✅ | ✅ |
| CSP | 🟡 partial (meta) | ✅ full + reporting | ✅ |
| X-Frame-Options / frame-ancestors | ❌ | ✅ | ✅ |
| X-Content-Type-Options | ❌ | ✅ | ✅ |
| Referrer-Policy | ✅ (meta) | ✅ | ✅ |
| Permissions-Policy | ❌ | ✅ | ✅ |
| COOP / CORP | ❌ | ✅ | ✅ |
| security.txt | ✅ | ✅ | — |

The backend already meets the 2026 baseline. The frontend meets it **after the
Phase-1 host migration** — the single most impactful item on this plan.

## 6. DNS-layer hardening & anti-abuse (do now — provider-side, no code)

Verified absent on 2026-07-03 (`dig` returned no DS, no CAA, no MX). These are the
only action items that do **not** wait on the host migration; set them at the domain
registrar / DNS provider for `0penrx.org`.

| Control | Status | Record to add |
|---|---|---|
| **DNSSEC** | ❌ absent | Enable DNSSEC at the DNS provider, then publish the generated **DS** record at the registrar. Prevents DNS spoofing / cache-poisoning — the single biggest unaddressed gap. |
| **CAA** | ❌ absent | `0penrx.org. CAA 0 issue "letsencrypt.org"` (add the CA your host uses; Cloudflare also uses `pki.goog` / `ssl.com`), plus `0penrx.org. CAA 0 iodef "mailto:info@qantm.ai"`. Restricts who can mint certs for the domain. |
| **Mail anti-spoof** (no mailbox on the domain) | ❌ absent | `0penrx.org. TXT "v=spf1 -all"` · null-MX `0penrx.org. MX 0 "."` · `_dmarc.0penrx.org. TXT "v=DMARC1; p=reject;"`. Stops spoofing of `@0penrx.org`. |

**Spam / bad-actor summary:** the site has no user input, no accounts, no forms, and a
read-only backend — the classic abuse vectors don't exist. Backend rate limiting is
real (120/60s per IP, XFF-aware, memory-bounded, `429`+`Retry-After`). Residual risks
are DNS-layer (fixed above) and volumetric/DDoS (absorbed by a Cloudflare front; also
switch the limiter's client-IP source to `CF-Connecting-IP` behind Cloudflare). The
2027+ items (PQ-TLS, CSP reporting, SLSA L3, shrinking cert lifetimes) are in §3
Phase 3 and are inherited from the host once the migration lands.
