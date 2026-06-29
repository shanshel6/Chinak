/**
 * delete-broken-image-products.js
 *
 * Scans every product's image URLs, checks each DISTINCT url only once (many
 * products can share the same url), and finds products whose images are ALL
 * broken (HTTP 404/410 — e.g. deleted alicdn images that return a 49-byte gif
 * placeholder). Those products are deleted from the database.
 *
 * SAFETY:
 *   - DRY RUN by default. Pass --apply to actually delete.
 *   - A url only counts as "broken" on a definitive 404/410. Timeouts, 403,
 *     429, 5xx and network errors are "uncertain" and NEVER cause deletion.
 *   - A product is deleted only if it has >=1 image url and EVERY url is broken.
 *   - Products with order history are SKIPPED (to protect orders) unless you
 *     pass --include-ordered.
 *   - Deletion removes child rows in a transaction (cart/wishlist/reviews/
 *     options/variants) then the product (ProductImage + UserInteraction
 *     cascade automatically).
 *   - A JSON report is written next to this script.
 *
 * USAGE:
 *   node server/scripts/delete-broken-image-products.js                 # dry run
 *   node server/scripts/delete-broken-image-products.js --apply         # delete
 *   node server/scripts/delete-broken-image-products.js --apply --concurrency=40
 *   node server/scripts/delete-broken-image-products.js --apply --include-ordered
 *   node server/scripts/delete-broken-image-products.js --limit=2000     # test subset
 *
 * Requires DATABASE_URL in the environment (see run_delete_broken_images.ps1).
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../prismaClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- args ----
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getOpt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const APPLY = hasFlag('apply');
const INCLUDE_ORDERED = hasFlag('include-ordered');
const DELETE_NO_IMAGES = hasFlag('delete-no-images'); // also delete products that have zero image urls
const CONCURRENCY = Math.max(1, parseInt(getOpt('concurrency', '20'), 10) || 20);
const LIMIT = parseInt(getOpt('limit', '0'), 10) || 0; // 0 = all
const TIMEOUT_MS = Math.max(3000, parseInt(getOpt('timeout', '15000'), 10) || 15000);
const RETRIES = Math.max(0, parseInt(getOpt('retries', '2'), 10));
const FRESH = hasFlag('fresh'); // ignore any saved checkpoint and start over

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- resumable progress checkpoint ----
// The slow part of this job is probing thousands of image URLs over HTTP. If the
// process dies (e.g. the DB connection drops during the delete phase), we don't
// want to re-probe everything. We persist DEFINITIVE url results (ok/broken) and
// the ids already deleted, then reload them on the next run. 'unknown' results
// are transient and intentionally NOT cached (they get re-checked).
const PROGRESS_PATH = path.join(__dirname, 'delete-broken-progress.json');

function loadProgress() {
  if (FRESH) {
    try { fs.unlinkSync(PROGRESS_PATH); } catch {}
    return { urlStatus: new Map(), deletedIds: new Set() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    return {
      urlStatus: new Map(Object.entries(raw.urlStatus || {})),
      deletedIds: new Set((raw.deletedIds || []).map(Number)),
    };
  } catch {
    return { urlStatus: new Map(), deletedIds: new Set() };
  }
}

function saveProgress(urlStatus, deletedIds) {
  const obj = {};
  for (const [u, s] of urlStatus) if (s === 'ok' || s === 'broken') obj[u] = s;
  const payload = { savedAt: new Date().toISOString(), urlStatus: obj, deletedIds: [...deletedIds] };
  const tmp = `${PROGRESS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, PROGRESS_PATH); // atomic swap so a crash mid-write can't corrupt it
}

function clearProgress() {
  try { fs.unlinkSync(PROGRESS_PATH); } catch {}
}

// ---- DB resilience: retry + reconnect on transient connection loss ----
const DB_MAX_RETRIES = Math.max(1, parseInt(getOpt('db-retries', '15'), 10) || 15);

function isRetryableDbError(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  return /can't reach database server|connection pool|timed out|connection closed|server has closed the connection|engine is not yet connected|response from the engine was empty|terminating connection|connection terminated|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i.test(msg)
    || ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'].includes(code);
}

// Run a DB operation, transparently reconnecting and retrying if the connection
// drops. Non-connection errors (and exhausted retries) are re-thrown.
async function withDbRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableDbError(err) || attempt >= DB_MAX_RETRIES) throw err;
      const waitMs = Math.min(30000, 1000 * attempt);
      console.warn(`      [db] ${label} — connection issue: ${err?.message || err}`);
      console.warn(`      [db] reconnecting (attempt ${attempt}/${DB_MAX_RETRIES}, waiting ${waitMs}ms)...`);
      try { await prisma.$disconnect(); } catch {}
      await sleep(waitMs);
      try { await prisma.$connect(); console.log('      [db] reconnected.'); }
      catch (e) { console.warn(`      [db] reconnect attempt failed: ${e?.message || e}`); }
    }
  }
}

const normalizeUrl = (raw) => {
  if (typeof raw !== 'string') return null;
  let u = raw.trim();
  if (!u) return null;
  if (u.startsWith('//')) u = `https:${u}`;
  if (!/^https?:\/\//i.test(u)) return null; // skip non-http (data:, file:, junk)
  return u;
};

/**
 * Returns 'ok' | 'broken' | 'unknown'.
 *  ok      -> 2xx (image exists)
 *  broken  -> definitive 404 / 410
 *  unknown -> anything else (403/429/5xx/timeout/network) — never deleted
 */
function probeOnce(rawUrl, redirectsLeft = 5) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let urlObj;
    try {
      urlObj = new URL(rawUrl);
    } catch {
      return done('unknown');
    }
    const lib = urlObj.protocol === 'http:' ? http : https;

    const req = lib.request(
      urlObj,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          Range: 'bytes=0-0',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          res.destroy();
          let next;
          try {
            next = new URL(res.headers.location, urlObj).toString();
          } catch {
            return done('unknown');
          }
          return probeOnce(next, redirectsLeft - 1).then(done);
        }
        res.destroy(); // we only need the status line, not the body
        if (status >= 200 && status < 300) return done('ok');
        if (status === 404 || status === 410) return done('broken');
        return done('unknown');
      }
    );
    req.on('error', () => done('unknown'));
    req.on('timeout', () => { req.destroy(); done('unknown'); });
    req.end();
  });
}

async function checkUrl(rawUrl) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const r = await probeOnce(rawUrl);
    if (r === 'ok' || r === 'broken') return r; // definitive
    if (attempt < RETRIES) await sleep(500 * (attempt + 1)); // back off on 'unknown'
  }
  return 'unknown';
}

// Simple concurrency pool over an array of items.
async function pool(items, concurrency, worker, onProgress) {
  let i = 0;
  let done = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
      done++;
      if (onProgress && done % 500 === 0) onProgress(done, items.length);
    }
  });
  await Promise.all(runners);
}

async function main() {
  console.log('==========================================================');
  console.log(' Broken-image product cleanup');
  console.log(`  mode:             ${APPLY ? 'APPLY (will delete)' : 'DRY RUN (no changes)'}`);
  console.log(`  concurrency:      ${CONCURRENCY}`);
  console.log(`  include-ordered:  ${INCLUDE_ORDERED}`);
  console.log(`  delete-no-images: ${DELETE_NO_IMAGES}`);
  console.log(`  product limit:    ${LIMIT || 'all'}`);
  console.log('==========================================================\n');

  // 1) Load products + their image urls.
  console.log('[1/4] Loading products and image urls from the database...');
  const productRows = await withDbRetry(
    () => prisma.$queryRawUnsafe(`SELECT id, image FROM "Product"${LIMIT ? ` ORDER BY id LIMIT ${LIMIT}` : ''}`),
    'loading products'
  );
  const idSet = new Set(productRows.map((p) => Number(p.id)));
  const imageRows = await withDbRetry(
    () => prisma.$queryRawUnsafe(`SELECT "productId", url FROM "ProductImage"`),
    'loading product images'
  );

  // product id -> Set of normalized urls
  const productUrls = new Map();
  const ensure = (id) => {
    if (!productUrls.has(id)) productUrls.set(id, new Set());
    return productUrls.get(id);
  };
  for (const p of productRows) {
    const u = normalizeUrl(p.image);
    const set = ensure(Number(p.id));
    if (u) set.add(u);
  }
  for (const row of imageRows) {
    const id = Number(row.productId);
    if (!idSet.has(id)) continue; // respects --limit
    const u = normalizeUrl(row.url);
    if (u) ensure(id).add(u);
  }

  // 2) Build the DISTINCT url set (each url checked once).
  const distinctUrls = new Set();
  for (const set of productUrls.values()) for (const u of set) distinctUrls.add(u);
  const urlList = [...distinctUrls];
  const totalRefs = [...productUrls.values()].reduce((a, s) => a + s.size, 0);
  console.log(
    `      ${productRows.length} products, ${urlList.length} distinct urls ` +
      `(${totalRefs} total references -> ${totalRefs - urlList.length} duplicate checks avoided)\n`
  );

  // 3) Check each distinct url once (resuming any results from a prior run).
  console.log('[2/4] Checking image urls over HTTP (404/410 = broken)...');
  const { urlStatus: cachedStatus, deletedIds } = loadProgress();
  const urlStatus = new Map();
  let okCount = 0;
  let brokenCount = 0;
  let unknownCount = 0;
  // Pre-load definitive results saved by a previous (interrupted) run.
  for (const u of distinctUrls) {
    const s = cachedStatus.get(u);
    if (s === 'ok' || s === 'broken') {
      urlStatus.set(u, s);
      if (s === 'ok') okCount++; else brokenCount++;
    }
  }
  if (urlStatus.size) {
    console.log(`      resumed ${urlStatus.size} url result(s) from checkpoint — re-checking only the remaining ${urlList.length - urlStatus.size}`);
  }

  let checkedSinceFlush = 0;
  await pool(
    urlList,
    CONCURRENCY,
    async (u) => {
      if (urlStatus.has(u)) return; // already known from the checkpoint
      const s = await checkUrl(u);
      urlStatus.set(u, s);
      if (s === 'ok') okCount++;
      else if (s === 'broken') brokenCount++;
      else unknownCount++;
      // Persist periodically so a crash loses at most ~1000 url checks.
      if ((s === 'ok' || s === 'broken') && ++checkedSinceFlush >= 1000) {
        saveProgress(urlStatus, deletedIds);
        checkedSinceFlush = 0;
      }
    },
    (done, total) => console.log(`      checked ${done}/${total} urls (ok:${okCount} broken:${brokenCount} uncertain:${unknownCount})`)
  );
  saveProgress(urlStatus, deletedIds); // flush before the (DB-touching) delete phase
  console.log(`      urls -> ok: ${okCount}, broken: ${brokenCount}, uncertain: ${unknownCount}\n`);

  // 4) Classify products.
  console.log('[3/4] Classifying products...');
  const allBroken = []; // every url broken
  const noImages = []; // zero usable urls
  const uncertain = []; // no ok url, but not all broken (has unknowns)
  for (const p of productRows) {
    const id = Number(p.id);
    const urls = [...(productUrls.get(id) || [])];
    if (urls.length === 0) {
      noImages.push(id);
      continue;
    }
    const statuses = urls.map((u) => urlStatus.get(u));
    if (statuses.every((s) => s === 'broken')) allBroken.push(id);
    else if (statuses.some((s) => s === 'ok')) { /* healthy: keep */ }
    else uncertain.push(id); // mix of broken + unknown, or all unknown -> keep, recheck later
  }
  const healthy = productRows.length - allBroken.length - noImages.length - uncertain.length;
  console.log(`      all-broken:        ${allBroken.length}`);
  console.log(`      no-images:         ${noImages.length}`);
  console.log(`      uncertain (kept):  ${uncertain.length}`);
  console.log(`      healthy (kept):    ${healthy}\n`);

  const toDelete = [...allBroken];
  if (DELETE_NO_IMAGES) toDelete.push(...noImages);

  // 5) Delete (or report).
  const deleted = [];
  const skippedOrdered = [];
  const failed = [];

  console.log(`[4/4] ${APPLY ? 'Deleting' : 'Would delete'} ${toDelete.length} products...`);
  if (APPLY && deletedIds.size) console.log(`      (skipping ${deletedIds.size} already deleted in a prior run)`);
  let deletedSinceFlush = 0;
  for (const id of toDelete) {
    if (deletedIds.has(id)) { deleted.push(id); continue; } // already deleted before the interruption

    const orders = await withDbRetry(() => prisma.orderItem.count({ where: { productId: id } }), `counting orders for #${id}`);
    if (orders > 0 && !INCLUDE_ORDERED) {
      skippedOrdered.push({ id, orders });
      console.log(`      SKIP   #${id} — has ${orders} order item(s) (use --include-ordered to force)`);
      continue;
    }

    if (!APPLY) {
      console.log(`      DELETE #${id}${orders > 0 ? ` (+${orders} order items)` : ''}`);
      deleted.push(id);
      continue;
    }

    try {
      await withDbRetry(() => prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { productId: id } });
        await tx.wishlistItem.deleteMany({ where: { productId: id } });
        await tx.review.deleteMany({ where: { productId: id } });
        if (INCLUDE_ORDERED) await tx.orderItem.deleteMany({ where: { productId: id } });
        await tx.productOption.deleteMany({ where: { productId: id } });
        await tx.productVariant.deleteMany({ where: { productId: id } });
        // Product.delete cascades ProductImage + UserInteraction (onDelete: Cascade)
        await tx.product.delete({ where: { id } });
      }), `deleting #${id}`);
      deletedIds.add(id);
      deleted.push(id);
      console.log(`      DELETED #${id}`);
      // Checkpoint every 50 deletions so a DB drop resumes near where it stopped.
      if (++deletedSinceFlush >= 50) { saveProgress(urlStatus, deletedIds); deletedSinceFlush = 0; }
    } catch (err) {
      failed.push({ id, error: err?.message || String(err) });
      console.warn(`      FAILED  #${id}: ${err?.message || err}`);
    }
  }
  if (APPLY) saveProgress(urlStatus, deletedIds); // flush the final batch of deletions

  // 6) Report.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(__dirname, `broken-image-report-${stamp}.json`);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    options: { concurrency: CONCURRENCY, includeOrdered: INCLUDE_ORDERED, deleteNoImages: DELETE_NO_IMAGES, limit: LIMIT },
    totals: {
      productsScanned: productRows.length,
      distinctUrls: urlList.length,
      urlOk: okCount,
      urlBroken: brokenCount,
      urlUncertain: unknownCount,
      allBroken: allBroken.length,
      noImages: noImages.length,
      uncertain: uncertain.length,
      deleted: deleted.length,
      skippedOrdered: skippedOrdered.length,
      failed: failed.length,
    },
    allBrokenIds: allBroken,
    noImageIds: noImages,
    uncertainIds: uncertain,
    deletedIds: deleted,
    skippedOrdered,
    failed,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n==========================================================');
  console.log(` ${APPLY ? 'Deleted' : 'Would delete'}: ${deleted.length} products`);
  if (skippedOrdered.length) console.log(` Skipped (have orders): ${skippedOrdered.length}`);
  if (failed.length) console.log(` Failed: ${failed.length}`);
  console.log(` Report: ${reportPath}`);
  if (!APPLY) console.log(' DRY RUN — nothing deleted. Re-run with --apply to delete.');
  console.log('==========================================================');

  // Run finished cleanly — drop the checkpoint so the next run starts fresh.
  // (If the process had died mid-run, this line wouldn't be reached and the
  //  checkpoint would remain for the next run to resume from.)
  clearProgress();

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[delete-broken-image-products] FATAL:', err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
