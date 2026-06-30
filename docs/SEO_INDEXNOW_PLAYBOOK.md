# 0penRX — IndexNow & Maximum-Exposure Playbook

How to get 0penRX found by **every search engine** and **every AI assistant** that
honors web standards. All facts here were verified against primary sources
(Microsoft/Bing IndexNow docs, Google Search Central, Cloudflare, the official
crawler docs) in June 2026. Where 2026 reality differs from older blog advice,
it is flagged.

> **The single most important finding first.** AI crawlers — **GPTBot, OAI-SearchBot,
> ClaudeBot, PerplexityBot — do NOT execute JavaScript.** They read the raw HTML
> the server returns and move on. 0penRX renders its 86-drug catalog client-side
> from `catalog.js`, so **AI assistants currently see the static shell (title,
> meta, JSON-LD, hero copy, Coupon Guide, `llms.txt`) but not the JS-rendered drug
> grid.** Submitting URLs and welcoming crawlers (below) maximizes what they CAN
> see today; the real unlock for AI + long-tail SEO is **per-drug static pages**
> (see §8). Only Googlebot (and Google's Gemini, which rides it) renders JS.

---

## 1. IndexNow — what it is and who consumes it

IndexNow is an open ping protocol: you tell one participating engine a URL
changed, and it shares that with the whole network within ~10s. **One submission
reaches all of them.**

- **Consumers:** Microsoft **Bing**, **Yandex**, **Seznam.cz**, **Naver**, **Yep**
  (and Amazon consumes the data). Microsoft now recommends IndexNow as the primary
  real-time submission method.
- **Google does NOT participate.** Use Search Console for Google (§6).
- Bing → Copilot and other Bing-grounded answer engines, so IndexNow indirectly
  feeds AI answers too.

---

## 2. Step 1 — Generate the key

- **Allowed characters:** `a–z A–Z 0–9 -`. (The spec says "hexadecimal" but then
  permits the full set — the binding rule is this character set.)
- **Length:** 8–128 characters.

0penRX's key was generated with:

```bash
openssl rand -hex 16        # → 32-char key, e.g. c44addc09154544410eb831742ea4974
```

**The live key for 0penRX is `c44addc09154544410eb831742ea4974`.** To rotate it,
generate a new one, replace the key file, and update nothing else (the submitter
auto-discovers it).

## 3. Step 2 — Host the key file

- **File name:** `<key>.txt` — the file name IS the key.
- **Content:** the key value only, as a UTF-8 text file (no trailing junk).
- **Location:** the **site root** → `https://0penrx.org/<key>.txt`. (You may host
  it elsewhere and pass `keyLocation`, but root is simplest.)
- **Retention:** keep it live **permanently**. Engines re-fetch it to re-verify
  ownership on every submission; if it 404s, submissions fail with 403. (Older
  blogs claiming a "24-hour" retention are wrong — there is no published expiry.)

In this repo the file is committed at the root as
`c44addc09154544410eb831742ea4974.txt`, so GitHub Pages serves it at the domain
root automatically. Verify after deploy:

```bash
curl -s https://0penrx.org/c44addc09154544410eb831742ea4974.txt
# → c44addc09154544410eb831742ea4974
```

## 4. Step 3 — Submit changed URLs (three methods)

### Method A — single-URL GET (simplest)

```
https://api.indexnow.org/indexnow?url=<URL>&key=<KEY>&keyLocation=<KEYFILE_URL>
```

Real command for the homepage:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://api.indexnow.org/indexnow?url=https://0penrx.org/&key=c44addc09154544410eb831742ea4974&keyLocation=https://0penrx.org/c44addc09154544410eb831742ea4974.txt"
```

`url` and `key` are required; `keyLocation` is optional when the key is at root
(include it anyway — explicit is safer).

### Method B — bulk POST (up to 10,000 URLs per request)

```bash
curl -s -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "host": "0penrx.org",
    "key": "c44addc09154544410eb831742ea4974",
    "keyLocation": "https://0penrx.org/c44addc09154544410eb831742ea4974.txt",
    "urlList": ["https://0penrx.org/"]
  }'
```

Required header: `Content-Type: application/json; charset=utf-8`. Every URL in
`urlList` must belong to `host`. Max **10,000 URLs/request**. No single numeric
rate limit (per-engine thresholds) — wait ≥5 min before resubmitting the same URL,
and only submit when content actually changed.

### Method C — the repo's Node script (no dependencies)

```bash
node scripts/indexnow-submit.mjs                       # homepage (GET)
node scripts/indexnow-submit.mjs https://0penrx.org/   # one URL (GET)
node scripts/indexnow-submit.mjs --bulk url1 url2 ...   # many (POST)
node scripts/indexnow-submit.mjs --from-sitemap         # every <loc> in sitemap.xml
```

It auto-discovers the key from the `<key>.txt` at the repo root and prints the
decoded response code. This is what the automation workflow (§7) runs.

## 5. Full HTTP response-code table

| Code | Meaning | Action |
|---|---|---|
| **200** | OK — submitted and validated | Done |
| **202** | Accepted — received; key validation still pending | Normal on first submit; fine |
| **400** | Bad Request — invalid format | Fix the URL/JSON |
| **403** | Forbidden — key file not found at `keyLocation`, or value mismatch | Confirm the key file is live and matches |
| **422** | Unprocessable — URL(s) not under this host, or key/schema mismatch | Ensure URLs are on `0penrx.org` |
| **429** | Too Many Requests — rate-limited | Back off, retry later |

`200` and `202` are both success.

## 6. Step 4 — Verify in Bing Webmaster Tools

1. Sign in at <https://www.bing.com/webmasters> and add/verify `0penrx.org` (you
   can import verification from Google Search Console).
2. Submit `https://0penrx.org/sitemap.xml` under **Sitemaps**.
3. Under **IndexNow**, Bing shows your key + submission history. The first GET/POST
   above also auto-registers the key on first use.
4. Bing also offers a manual **Submit URLs** quota — adaptive, up to **10,000/day**
   for established/verified sites (newer sites get less).

---

## 7. Automation

### For THIS site (GitHub Pages): the `indexnow.yml` workflow ✅

`.github/workflows/indexnow.yml` auto-submits on every push to `main` that changes
the homepage content (`index.html`, `assets/catalog.js`, `assets/app.js`,
`assets/styles.css`, `sitemap.xml`, `llms.txt`), after a 90s wait for Pages to
publish. It runs `scripts/indexnow-submit.mjs --from-sitemap`. Zero external
services, no key plumbing beyond the committed key file.

### Cloudflare Crawler Hints — the usual "easiest win," but NOT for this site ⚠️

Cloudflare Crawler Hints auto-submits to IndexNow on cache MISS with one toggle
(**dash → Caching → Configuration → Crawler Hints**, free on all plans). **But it
requires the domain to be PROXIED through Cloudflare (orange cloud)** — and that
**conflicts with GitHub Pages**:

- GitHub Pages needs the DNS record **DNS-only (grey cloud)** to issue *and renew*
  its Let's Encrypt cert. Proxied, GitHub can't complete ACME validation; renewal
  can silently fail weeks later and take the site down.
- You'd have to terminate TLS at Cloudflare (SSL mode **Full**, not Full Strict),
  turn **off** GitHub's "Enforce HTTPS," and accept the renewal-conflict risk.

0penRX currently has GitHub-managed HTTPS enforced and working. **Recommendation:
do NOT proxy through Cloudflare just for Crawler Hints** — the `indexnow.yml`
workflow gives the same benefit with none of the TLS risk. Only adopt Crawler
Hints if you migrate TLS management to Cloudflare deliberately.

---

## 8. Submitting to every search engine + AI model

| Target | How | Reality (2026) |
|---|---|---|
| **Bing, Yandex, Seznam, Naver, Yep** | IndexNow (§4) — one ping hits all | Native, instant |
| **Google** | robots.txt `Sitemap:` line (already set) + **Search Console** → submit sitemap; **URL Inspection → Request Indexing** for the homepage (manual, rate-limited, no guarantee) | The old `google.com/ping?sitemap=` endpoint is **DEAD (404 since ~late 2023)**. The Indexing API is **only** for `JobPosting`/`BroadcastEvent` — not general pages. |
| **ChatGPT / Copilot** | Be in the **Bing index** (IndexNow + bingbot) → Copilot and ChatGPT web search are Bing-grounded. Allow `GPTBot`, `OAI-SearchBot` in robots.txt (done). | Bing is the chokepoint; don't block bingbot |
| **Claude** | Allow `ClaudeBot`, `Claude-SearchBot`, `Claude-User` (done) | Anthropic honors robots.txt |
| **Perplexity** | Allow `PerplexityBot` (done) | Note: also crawls undeclared; allowing signals intent |
| **Gemini / Google AI** | Allow `Google-Extended` (done) + be in Google index | Gemini renders JS (rides Googlebot) |
| **Apple Intelligence** | Allow `Applebot-Extended` (done) | Control token only |
| **Common Crawl → many models** | Allow `CCBot` (done) | Feeds many training sets |
| **All of the above** | Ship `llms.txt` (done) + maximally crawlable static HTML | `llms.txt` is ~10% adopted, near-zero confirmed consumption today — a cheap hedge, not a traffic source |

**robots.txt posture:** 0penRX explicitly **allows** every major AI crawler (it
*wants* to be cited). See `robots.txt`. Note `Google-Extended`/`Applebot-Extended`
are usage-control tokens (no separate fetcher); `bingbot` is the single gate for
the entire Bing-grounded AI ecosystem; Perplexity and Bytespider are documented to
ignore robots.txt in practice (block at WAF if you ever need to exclude them).

---

## 9. Metadata — what's in place and why

The static `<head>` (see `index.html`) carries the full modern set: unique
`<title>` + `description`, self-referencing `canonical`, `robots` with
`max-image-preview:large`, complete Open Graph + Twitter Card (1200×630
`og-image.png`), `theme-color`, icons, manifest, preconnect/preload, and a
JSON-LD `@graph` (WebSite + Organization + WebApplication).

2026 notes baked into these choices:
- **No `SearchAction`/sitelinks-searchbox** — Google removed that rich result on
  Nov 21, 2024; the markup renders nothing.
- **Descriptions are accurate** — they no longer claim "federal program / Amazon
  Pharmacy" comparisons the product doesn't make (a no-fabrication fix).
- `max-image-preview:large` lets Google/▷AI use the full preview image.

---

## 10. SEO best practices to match and beat (2026)

**Structured data that still produces rich results:** Organization (brand entity),
BreadcrumbList (once per-drug pages exist), FAQPage (health sites are eligible, but
the rich result needs established authority — add it anyway for AI extraction).
Add `MedicalWebPage` + `Drug` (+ `Offer` for a real price) per drug for AI/semantic
clarity — Google draws no card from them, but AI assistants read them.

**Core Web Vitals targets (75th percentile real users):** LCP ≤ 2.5s · **INP ≤
200ms** (replaced FID in 2024) · CLS ≤ 0.1. Static-site risk is INP from heavy
client-side catalog filtering — debounce/virtualize. Set explicit image/table
dimensions to keep CLS ≈ 0.

**E-E-A-T / YMYL (this is health + money — the strict tier):** add a real **About**
page (who runs it, funding/business model), a **medical reviewer** byline + date,
visible **"prices updated"** dates, explicit **sourcing/methodology**, and contact +
correction policy. These proxy signals matter most for a new YMYL site.

**The competitive bar (GoodRx/SingleCare):** per-drug indexable landing pages at
scale, each with unique copy, price context, alternatives, and FAQ. **This is the
#1 thing to match — and the same change that fixes AI visibility (§ top).**

### The roadmap that surpasses them (v1.1+)
1. **Pre-render one static HTML page per drug** (Astro/Eleventy/Next static export
   on GitHub Pages): real content + JSON-LD in the initial HTML → visible to Google,
   ChatGPT, Claude, Perplexity, and indexable for the long-tail "[drug] cash price"
   queries. Hydrate with JS after.
2. **Expand `sitemap.xml`** to list every drug URL; the `indexnow.yml` workflow then
   pings all of them on change.
3. **History-API routing** (`/drugs/atorvastatin`), never hash routes — hash
   fragments are not indexed as separate pages.
4. **Lean into radical transparency** (open data sources + update cadence) as the
   E-E-A-T differentiator the affiliate-coupon incumbents lack.

---

## 11. Quick reference

| Thing | Value |
|---|---|
| IndexNow key | `c44addc09154544410eb831742ea4974` |
| Key file URL | `https://0penrx.org/c44addc09154544410eb831742ea4974.txt` |
| IndexNow endpoint | `https://api.indexnow.org/indexnow` |
| Submit script | `node scripts/indexnow-submit.mjs --from-sitemap` |
| Auto-submit | `.github/workflows/indexnow.yml` (on content push) |
| Google | Search Console + robots.txt Sitemap line (no IndexNow, no ping endpoint) |
| Sitemap | `https://0penrx.org/sitemap.xml` |
| AI crawlers | all allowed in `robots.txt`; `llms.txt` content map shipped |
