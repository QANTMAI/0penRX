# 0penRX — Security Threat Model

**Status:** Living document · **Scope:** The public, read-only 0penRX prescription drug-price-comparison website (`https://0penrx.org`), its static frontend bundle, the curated pricing/coupon catalog it publishes, the client-side integrations with public government/FDA APIs, the optional self-host FastAPI backend, and the repository's CI/supply-chain controls. This document complements the repository-root [`SECURITY.md`](../../SECURITY.md), which defines reporting (GitHub private vulnerability reporting), coordinated disclosure, and the treatment of data-integrity errors as a security-class issue.

0penRX has no server in production, no user accounts, no database, no session state, and handles no PII, PHI, credentials, or payment data. The threat surface is therefore dominated by **integrity** (of published data and of the deployed bundle), not confidentiality.

---

## 1. Actors

| Actor | Trusted? | Capability |
|---|---|---|
| Anonymous site visitor | No | Loads the static site over HTTPS; triggers client-side read-only GET requests to public APIs; sees only what is published. No write path, no auth, no state. |
| External contributor (PR author) | No | Opens pull requests against the repo, including changes to the curated catalog and the static bundle. Cannot merge. |
| Maintainer (write access) | Partially | Reviews and merges PRs, edits the curated catalog, triggers deployment to GitHub Pages. Subject to branch protection and required review. |
| GitHub Actions CI | Partially | Runs lint/test/CodeQL on PRs and ingestion jobs; executes with repository-scoped permissions; can publish the Pages artifact. |
| Upstream public APIs (NLM RxNorm, openFDA, CMS NADAC) | No (external dependency) | Serve drug identity, NDC/labeler/dosage, and per-unit acquisition cost data over CORS (`Access-Control-Allow-Origin: *`). Read-only; outside our control. |
| Package / Action supplier (PyPI, GitHub Actions Marketplace) | No (external dependency) | Provides build/test/ingestion dependencies and reusable Actions pulled into CI. |

---

## 2. Assets

1. **Integrity of published pricing and coupon data (highest-value asset).** The per-unit prices and adjudication codes (BIN / PCN / Group / Member ID) presented to users. A wrong price or a wrong adjudication code can fail a real person at the pharmacy counter. All such data is labeled **"reference — verify before use."**
2. **Integrity and authenticity of the deployed static bundle** (HTML/CSS/vanilla-JS) served at `https://0penrx.org` — i.e., assurance that what a visitor loads is exactly what was reviewed and merged.
3. **Availability of the public site** for visitors who depend on it to compare drug prices.
4. **Integrity of the repository and its history** (main branch, CI configuration, deployment workflow).
5. **Reputation / trustworthiness** of the project as an accurate, transparent price reference.

**There is no user PII, PHI, account credential, payment instrument, session token, or backend secret in scope.** No such data is collected, stored, transmitted, or present in the client bundle. Confidentiality of user data is therefore not an asset because no user data exists.

---

## 3. Threats × Mitigations

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| 1 | **Stale or incorrect published price or BIN/PCN/Group/Member code** reaches a user and fails at the counter. | Curated catalog is version-controlled and changes require review; NADAC/openFDA-derived figures are sourced from authoritative public datasets; all prices and coupon codes are explicitly labeled "reference — verify before use"; data-integrity errors are treated as a security-class issue per `SECURITY.md` with a coordinated-disclosure path. | Hand-maintained catalog entries can still drift from real-world adjudication between updates; upstream data has its own lag. The "verify before use" label is the last line of defense, not a guarantee of correctness. |
| 2 | **Malicious PR injecting bad data or client-side XSS** into the static bundle. | Branch protection with required review on `main` (no direct pushes); CodeQL static analysis for JavaScript on PRs; vanilla-JS modules served same-origin with no third-party JS bundles to subvert; no server-side rendering or templating, narrowing injection surface. | A subtle malicious change could pass review; CodeQL is not exhaustive. DOM-sink discipline in the JS is enforced by review, not by a framework's auto-escaping. |
| 3 | **Compromised dependency / supply-chain attack** via a poisoned package or Action. | Dependabot for `pip` and `github-actions`; CodeQL for Python and JavaScript; **GitHub Actions pinned to full commit SHAs** (immutable; the `# vN` comment records the version, and Dependabot still bumps the SHA); pre-commit secret scanning; production site ships **no third-party JS** (build/test dependencies do not reach the deployed bundle). | A SHA pin can only change via a reviewed PR, so a re-pointed/compromised tag cannot be silently pulled. Transitive Python deps affect ingestion/CI, not the served site, but could still poison catalog data (see #6). |
| 4 | **Compromised CI secret or maintainer GitHub account** alters the deployed site. | Branch protection + required review limits unilateral change to `main`; workflows declare least-privilege `permissions: contents: read` (elevated only where required, e.g. CodeQL); CI configuration is itself reviewed; coordinated-disclosure and rapid-rollback posture via Git history. | A fully compromised maintainer account with review-bypass or a leaked high-privilege token could still publish a malicious Pages artifact. 2FA/account hygiene is assumed but not enforced by this repo. Findings that *require* a compromised maintainer machine are out of scope (§4). |
| 5 | **Upstream public API serves malformed or poisoned data** (RxNorm, openFDA, NADAC). | Client treats upstream responses as untrusted input; the "reference — verify before use" labeling applies to all derived figures; data is fetched read-only and never granted any privilege beyond display. | We cannot guarantee upstream accuracy or availability; a compromised or erroneous upstream feed could surface wrong identity/cost data to users. Client-side validation is best-effort. |
| 6 | **DoS against the public site.** | Static hosting on GitHub Pages absorbs load via GitHub's CDN; no origin server, database, or compute to exhaust; all dynamic data fetching happens in the visitor's own browser against third-party APIs. | Availability ultimately depends on GitHub Pages and on the upstream APIs' own rate limits/availability, neither of which we control. |
| 7 | **Tampering with data in transit** (MITM, response injection). | GitHub Pages enforced HTTPS for the site; all upstream API calls are HTTPS GET; fonts are self-hosted same-origin. | TLS protects transport, but the integrity of upstream API *content* is still only as good as the provider (see #5). No response-signing exists for upstream data. |

---

## 4. Explicit Out-of-Scope Threats

The following are intentionally **not** in scope for this threat model:

- **User-data breaches / confidentiality of personal data** — there is no user data: no accounts, no PII/PHI, no payment data, no session state.
- **Medical or clinical correctness** — 0penRX is a price *reference*, not clinical advice; whether a drug, dose, or therapy is appropriate is out of scope and out of the project's purpose.
- **Security of third-party destination sites** (e.g., GoodRx, Mark Cuban Cost Plus Drug Company, or any pharmacy/coupon site a user navigates to) — these are independent properties under their own control.
- **Findings that require a compromised maintainer machine or compromised maintainer credentials** as a precondition (e.g., local malware exfiltrating a personal token). Account/endpoint hygiene is assumed.
- **Backend exposure in production** — the FastAPI backend (`backend/app.py`) **is** deployed in production (Render, `openrx-api.onrender.com`) and serves read-only `GET /health`, `GET /coupons`, and the optional `GET /coupons/goodrx` proxy. It exposes no pricing endpoint — prescription pricing is fetched client-side from CMS NADAC. Attack surface is constrained by: CORS locked to `https://0penrx.org`, `allow_methods=["GET"]` (no mutations), no database, and secrets (GoodRx keys) read from host env vars only. Self-hosters own their own deployment's threat model.

---

## 5. Static-Site & Supply-Chain Posture

Because 0penRX has no production server and performs no cryptographic operations of its own, the controls a server/crypto application would document (key management, TLS termination parameters, auth tokens) do not apply. The equivalent assurance surface for a static, read-only site is **bundle integrity and supply-chain provenance**:

- **No secrets in the client bundle.** The deployed HTML/CSS/JS contains no API keys, tokens, or credentials; the public APIs used require none. Pre-commit secret scanning guards against accidental introduction.
- **All third-party calls are read-only `GET` over TLS** to public government/FDA endpoints (NLM RxNorm, openFDA, CMS NADAC), each of which returns `Access-Control-Allow-Origin: *`, enabling direct browser fetches without a proxy. No write, no auth, no state-changing request is made.
- **Transport.** GitHub Pages **enforced HTTPS** for the site; all upstream API fetches are HTTPS.
- **Repository integrity.** **Branch protection with required review** on `main`; no direct pushes; CI configuration and deployment workflow are themselves reviewed changes.
- **Dependency & supply-chain controls.** **Dependabot** for `pip` and `github-actions`; **CodeQL** for **Python and JavaScript**; **pre-commit** with **secret scanning**; workflows declare **least-privilege `permissions`**; **GitHub Actions are pinned to full commit SHAs** (immutable, with a `# vN` version comment). Build/test/ingestion dependencies are not shipped to the browser.
- **First-party JavaScript only.** The app loads **no third-party JS bundles**; all behavior is vanilla-JS modules served **same-origin**. This removes the largest class of static-site supply-chain risk (a compromised CDN-hosted script executing in the page).
- **No cross-origin subresources.** Fonts are **self-hosted** (`assets/fonts/*.woff2`, same-origin) — the previous Google Fonts `<link>` (and its CSS-then-font cross-origin delivery) has been removed, so the page now loads **zero** third-party CSS, JS, or font subresources. Everything the browser parses is served same-origin from GitHub Pages; the only cross-origin traffic is the read-only data `fetch()`es to the public gov/FDA APIs.
- **Content-integrity caveat.** The curated drug/price/coupon catalog is **hand-maintained data**, not a cryptographically attested feed. It is published as **"reference — verify before use,"** and its accuracy is a review-and-disclosure concern (see §3 #1 and `SECURITY.md`), not something enforced by transport or build tooling.

---

## 6. Audit & Compliance

Control evidence for 0penRX consists of repository-visible, version-controlled artifacts:

- **This threat model** (`docs/security/threat_model.md`) — documents assets, actors, and threat/mitigation reasoning.
- **[`SECURITY.md`](../../SECURITY.md)** (repo root) — reporting via GitHub private vulnerability reporting, coordinated disclosure, and the policy that **data-integrity errors are treated as a security-class issue**.
- **CI** (`.github/workflows/`) — `ruff` lint and `pytest` on pull requests; ingestion workflow for data refresh.
- **CodeQL** — static analysis for Python and JavaScript.
- **Dependabot** — automated dependency-update surveillance for `pip` and `github-actions`.
- **pre-commit with secret scanning** — prevents accidental credential introduction.
- **Branch protection + required review on `main`** — the merge gate evidencing four-eyes control over published content and code.

**Disclosure process:** security issues — including data-integrity errors — are reported privately through GitHub's private vulnerability reporting and handled under coordinated disclosure as defined in `SECURITY.md`.
