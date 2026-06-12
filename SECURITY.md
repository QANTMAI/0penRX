# Security Policy

0penRX is a public, read-only prescription-price information service. It collects
no user accounts, no payment data, and no personal health information. The
security surface is therefore small but not zero — the highest-value asset is the
**integrity of the pricing data we publish**, because incorrect prices or coupon
codes can send a user to a pharmacy counter with a number that does not work.

This policy follows the structure used across our other projects (see the
SYNAPSE `docs/security/whdms_threat_model.md` companion): actors, assets,
threats × mitigations, and explicit out-of-scope items.

---

## Supported versions

0penRX ships continuously from `main`; the deployed site at
[`0penrx.org`](https://0penrx.org) always reflects the latest `main`. Security
fixes are applied to `main` only — there are no maintained release branches.

| Version | Supported |
|---------|-----------|
| `main` (deployed) | ✅ |
| Any older commit / fork | ❌ |

## Reporting a vulnerability

**Do not open a public issue for a security or data-integrity problem.** This
matches the guidance in [`CONTRIBUTING.md`](CONTRIBUTING.md).

Use **GitHub private vulnerability reporting**:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Security Advisories).
2. Or, if that is unavailable to you, contact the maintainer privately through
   GitHub ([@QANTMAI](https://github.com/QANTMAI)).

Please include:

- A description of the issue and the affected area (frontend, backend API, data
  ingestion, CI/CD, or a published price/coupon value).
- Steps to reproduce, or the specific record/URL involved.
- The impact you believe it has.

### What to expect

| Stage | Target |
|-------|--------|
| Acknowledgement of your report | within **3 business days** |
| Initial assessment + severity | within **7 business days** |
| Fix or mitigation for valid high-severity issues | as soon as practical; coordinated with you before any public disclosure |

We practice **coordinated disclosure**: we will agree a disclosure timeline with
you and credit you (if you wish) once a fix is deployed.

---

## Threat model

### Actors

| Actor | Trusted? | Capability |
|-------|----------|------------|
| Anonymous site visitor | untrusted | reads published prices; runs client-side JS |
| Contributor / PR author | untrusted until reviewed | proposes code and data changes via pull request |
| Maintainer | trusted | merges to `main`, controls deploy and CI secrets |
| Upstream data source (CMS NADAC, etc.) | honest-but-stale | supplies pricing data we ingest and republish |
| Dependency / CI supply chain | semi-trusted | code that runs in build, ingestion, and deploy |

### Assets

1. **Published pricing and coupon data** (`index.html`, ingested JSONL) — the
   primary asset. Incorrect BIN/PCN/price values cause real-world harm at the
   pharmacy counter. MUST be sourced and verifiable.
2. **Integrity of the deployed site** — `0penrx.org` served via GitHub Pages.
3. **CI/CD and deploy permissions** — repository secrets and the GitHub Actions
   workflows that ingest data and publish the site.
4. **The maintainer's GitHub account** — controls all of the above.

> 0penRX intentionally holds **no** user PII, credentials, payment data, or PHI.
> There is no login, no database of users, and no server-side session state.

### Threats × mitigations

| # | Threat | Mitigation | Residual risk |
|---|--------|------------|---------------|
| T1 | Incorrect / stale published price or BIN-PCN code misleads a user | Disclaimers requiring verification at point of sale; goal: attach source + retrieval date to each value (tracked, not yet complete) | **medium — primary risk** |
| T2 | Malicious PR injects bad data or client-side script (XSS) into `index.html` | Required PR review before merge; static single-file app with no user-supplied input rendered as HTML | low |
| T3 | Compromised dependency in backend/ingestion supply chain | Minimal dependency set; CI runs in an isolated runner; pinning + Dependabot recommended (see roadmap) | medium |
| T4 | Compromised CI secret or maintainer account alters the deployed site | Branch protection + review on `main`; least-privilege workflow tokens; 2FA on the maintainer account | low |
| T5 | Upstream source (CMS NADAC) serves malformed or poisoned data | Ingestion validates/normalizes rows and skips unparseable values; output is reviewable before publish | low |
| T6 | Denial of service against the public site | Served by GitHub Pages CDN; static assets only | low |

### Explicit out-of-scope

- **User data breaches** — 0penRX stores no user data, so there is nothing to
  breach. Reports of "missing authentication" on a service that has no accounts
  are not vulnerabilities.
- **Medical/clinical correctness** — 0penRX surfaces *prices*, not medical
  advice. Drug-appropriateness questions are out of scope (see disclaimers).
- **Third-party destinations** — prices and programs at GoodRx, Cost Plus Drugs,
  Amazon Pharmacy, manufacturer sites, or government pages are owned by those
  parties; report issues to them. We will still fix an incorrect *link* we ship.
- **Findings that require a compromised maintainer machine or GitHub account** —
  these reduce to account security, not an 0penRX vulnerability.

---

## Safe harbor

We support good-faith security research. If you make a genuine effort to comply
with this policy — avoid privacy violations and service disruption, only
interact with assets you own or test data, and give us reasonable time to
respond before disclosure — we will not pursue or support legal action against
you for that research.

## Data-integrity reports are welcome

Because a wrong price is our biggest risk, **we treat a verifiable "this price or
coupon code is incorrect" report as a security-class issue**, not a routine bug.
Use the private reporting channel above if the error could cause financial harm
at the pharmacy; otherwise a normal issue is fine.
