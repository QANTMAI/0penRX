# Deploying the 0penRX backend

The site (`0penrx.org`) is a static GitHub Pages app and works on its own for
every **live** feature (RxNorm, openFDA, NADAC). A few features are **server-side
by design** and only activate when a backend is hosted and the frontend is
pointed at it:

| Feature | Needs backend? | Why |
|---|---|---|
| Drug search, openFDA, NADAC, shortages/recalls/FAERS | No | client-side, CORS-open |
| **Coupons & assistance** (`/coupons`) | **Yes** | served from `data/coupons.jsonl` |
| **Server-side openFDA key** | Yes | keeps the key off the public bundle |
| **GoodRx Partner API** (future) | Yes | HMAC, key-signed, not browser-safe |

Deploying once unlocks all of them.

---

## Option A — Render (easiest, free tier, git-connected)

1. Push this repo to GitHub (already done).
2. Go to **render.com → New → Blueprint**, connect the repo. Render reads
   [`render.yaml`](../render.yaml) and provisions a free **`openrx-api`** web
   service (Python 3.12, `uvicorn`, health check `/health`).
3. Click **Apply**. In ~2 min you get a URL like
   `https://openrx-api.onrender.com`.

That's it. No Dockerfile needed — Render uses the native Python runtime.

> Free-tier note: the service sleeps after ~15 min idle and cold-starts on the
> next request (a few seconds). Fine for this read-only API; upgrade the plan to
> keep it warm.

## Option B — Fly.io / Cloud Run / Railway (Dockerfile)

Use the repo-root [`Dockerfile`](../Dockerfile) (portable, no platform lock-in):

```bash
# Fly.io
fly launch --no-deploy        # accept the Dockerfile; pick a name/region
fly deploy

# Google Cloud Run
gcloud run deploy openrx-api --source . --region us-central1 --allow-unauthenticated

# Railway
railway up                    # auto-detects the Dockerfile
```

---

## Post-deploy (required to light up the site)

### 1. Point the frontend at your backend
The frontend reads `window.OPENRX_API`, which is set in the committed,
same-origin `assets/config.js` (loaded by `index.html` before the module
script). It already points at the production backend:

```js
// assets/config.js
window.OPENRX_API = 'https://openrx-api.onrender.com';
```

To target a different backend, edit that one line, then commit + push → GitHub
Pages redeploys → the **Coupons & assistance** section uses the new host.

> The old `?api=...` URL override was **removed as a security fix** (a crafted
> link could repoint the site at an attacker host). There is no URL override —
> `window.OPENRX_API` from `config.js` is the only mechanism. Test against a
> local backend by editing `config.js` locally and serving the site with
> `python -m http.server`.

### 2. Verify
```bash
curl https://openrx-api.onrender.com/health           # {"status":"ok"}
curl "https://openrx-api.onrender.com/coupons?drug=ozempic" | jq .count   # >= 1
```
Then open a drug on the site — the coupons section should render with real
BIN/PCN data.

### 3. (Optional) openFDA key for the higher rate limit
Get a key at <https://open.fda.gov/apis/authentication/>, set it as the
`OPENFDA_KEY` env var **in the host dashboard** (never commit it). The backend
will use it for its openFDA calls; the frontend can then route openFDA through
the backend if you choose.

### 4. Prescription pricing — no backend needed
NADAC acquisition-cost pricing is fetched **client-side, directly from CMS**
(`data.medicaid.gov`) by `assets/live.js`. There is no backend pricing endpoint:
the backend serves coupons and the optional GoodRx proxy only. Nothing to deploy
for pricing.

---

## Keeping the backend warm (cold starts)

Render's free tier **sleeps after ~15 min idle** and cold-starts in ~30s, so the
first visitor after a quiet period waits for it to wake. Two layers handle this:

1. **Built in (already done):** the coupons fetch uses a **35s timeout**, so a
   cold start still resolves and the visitor sees coupons (just a few seconds
   slower) instead of nothing.
2. **To eliminate the wait — an external uptime monitor (recommended, free):**
   point a free pinger at `https://openrx-api.onrender.com/health` every ~10 min.
   - [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com):
     add a monitor, URL = the `/health` endpoint, interval 5–10 min. Done.

   > Why not a GitHub Actions cron? On a **private** repo a 10-min ping would run
   > ~4,300 min/month — well over the 2,000 free Actions minutes — and Actions
   > `schedule` triggers drift 5–15 min on free runners, which is too loose to
   > reliably beat a 15-min sleep. A purpose-built uptime monitor is free and
   > precise. (Making the repo public would make Actions minutes free, if you
   > prefer that route.)

   Upgrading to Render's paid always-on plan removes sleeping entirely.

## Security checklist after deploy
- Keep `OPENRX_CORS_ORIGINS=https://0penrx.org` (the default in both config
  files) so only the site can call the API. Use `*` only for local testing.
- The API is **read-only** (GET only), holds **no user data**, and needs no
  database. The only secret is the optional `OPENFDA_KEY` (and, later, GoodRx
  credentials) — keep those in host env vars, never in the repo.
