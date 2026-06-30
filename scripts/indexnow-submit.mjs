#!/usr/bin/env node
// IndexNow submitter for 0penRX.
//
// Notifies the IndexNow network (Bing, Yandex, Seznam, Naver, Yep — one ping is
// shared with all) that URLs have changed. Google does NOT participate in
// IndexNow; use Search Console for Google.
//
// The key is auto-discovered from the <key>.txt file committed at the repo root
// (the same file that must be live at https://0penrx.org/<key>.txt). No deps.
//
// Usage:
//   node scripts/indexnow-submit.mjs                       # submit the canonical homepage
//   node scripts/indexnow-submit.mjs https://0penrx.org/   # submit one URL (GET)
//   node scripts/indexnow-submit.mjs --bulk url1 url2 ...  # submit many (POST)
//   node scripts/indexnow-submit.mjs --from-sitemap        # submit every <loc> in sitemap.xml
//
// Exit code is non-zero if the endpoint rejects the submission.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '0penrx.org';
const ENDPOINT = 'https://api.indexnow.org/indexnow'; // vendor-neutral; fans out to all
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Locate the key file (named <key>.txt, content === key) at the repo root ──
function discoverKey() {
  const txt = readdirSync(ROOT).filter(f => /^[A-Za-z0-9-]{8,128}\.txt$/.test(f));
  for (const f of txt) {
    const key = f.replace(/\.txt$/, '');
    const body = readFileSync(join(ROOT, f), 'utf8').trim();
    if (body === key) return { key, keyLocation: `https://${HOST}/${f}` };
  }
  throw new Error('No IndexNow key file found at repo root (expected <key>.txt whose content equals <key>).');
}

const RESPONSES = {
  200: 'OK — submitted and validated',
  202: 'Accepted — received; key validation still pending',
  400: 'Bad Request — invalid format',
  403: 'Forbidden — key not found at keyLocation, or key value mismatch',
  422: 'Unprocessable — URL(s) not under this host, or key/schema mismatch',
  429: 'Too Many Requests — rate-limited (back off and retry later)',
};

function urlsFromSitemap() {
  const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
}

async function submitSingle(url, { key, keyLocation }) {
  const u = `${ENDPOINT}?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}&keyLocation=${encodeURIComponent(keyLocation)}`;
  const res = await fetch(u, { method: 'GET' });
  return res.status;
}

async function submitBulk(urlList, { key, keyLocation }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList }),
  });
  return res.status;
}

function report(status) {
  const note = RESPONSES[status] || 'Unexpected status';
  console.log(`IndexNow → HTTP ${status}: ${note}`);
  // 200 and 202 are both success (202 = key still being verified the first time).
  return status === 200 || status === 202;
}

async function main() {
  const args = process.argv.slice(2);
  const key = discoverKey();
  console.log(`Using key ${key.key} (keyLocation ${key.keyLocation})`);

  let ok;
  if (args[0] === '--bulk') {
    ok = report(await submitBulk(args.slice(1), key));
  } else if (args[0] === '--from-sitemap') {
    const urls = urlsFromSitemap();
    console.log(`Submitting ${urls.length} URL(s) from sitemap.xml`);
    ok = report(urls.length === 1 ? await submitSingle(urls[0], key) : await submitBulk(urls, key));
  } else {
    const url = args[0] || `https://${HOST}/`;
    ok = report(await submitSingle(url, key));
  }
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('IndexNow submit failed:', e.message); process.exit(1); });
