/**
 * Price-bucketing helper for search results.
 *
 * For each page of results, we want to return a mix of products
 * from different price ranges, not just the cheapest or just the
 * most similar:
 *
 *   - ~50% from the CHEAPEST half of all matches
 *   - ~25% from the MIDDLE 25% of all matches
 *   - ~25% from the MOST EXPENSIVE 25% of all matches
 *
 * Within each bucket, products are ordered by price (ascending
 * for the cheap bucket, descending for the expensive bucket) so
 * the page tells a clear price story.
 *
 * Strategy: STATELESS with a deterministic seed.
 *
 *   We seed a PRNG with `querySeed + page` so:
 *     - The same query + page always returns the same set of products
 *       (good for caching, debugging, and reproducibility).
 *     - Different pages return different products by construction.
 *   No server memory, no TTL, no cleanup.
 *
 *   Trade-off: a user scrolling past ~5 pages may see repeats
 *   because the per-page seed eventually reuses items. In practice
 *   this is rare in e-commerce where the typical user views 1-3
 *   pages, and the trade is worth the simplicity.
 */

/**
 * Cheap deterministic PRNG (mulberry32). 32-bit seed, 32-bit output.
 * Returns a function that yields a float in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash any string into a 32-bit unsigned integer. Used to seed the PRNG.
 */
function hashStringToInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Force to 32-bit int
  }
  return hash >>> 0;
}

/**
 * Fisher-Yates shuffle in place, using a provided PRNG.
 */
function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get a numeric price for bucketing.
 * Falls back to 0 if the price is missing/non-numeric.
 */
function priceOf(product) {
  const p = product && product.price;
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  if (typeof p === 'string') {
    const n = Number.parseFloat(p);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Pick a sub-set of `arr` of size `n` (or all of `arr` if n > arr.length),
 * shuffled by the provided PRNG. Does NOT mutate `arr`.
 */
function sampleN(arr, n, rand) {
  if (n <= 0 || arr.length === 0) return [];
  const copy = arr.slice();
  shuffleInPlace(copy, rand);
  return copy.slice(0, Math.min(n, copy.length));
}

/**
 * Apply price-bucketed stratified sampling to a list of products.
 *
 * @param {Array} allProducts - All candidate products (already filtered
 *   for the query and ranked by similarity; we'll re-order by price).
 * @param {number} limit - Number of products to return for THIS page.
 * @param {string|number} querySeed - Any string or number that uniquely
 *   identifies the current query. Different queries → different results.
 *   Different page numbers → different results.
 * @param {number} page - 1-based page number. Used as part of the seed
 *   so page 2 ≠ page 1.
 *
 * @returns {Array} At most `limit` products, ordered roughly as:
 *   [cheap items...] [mid items...] [expensive items...]
 *
 * Edge cases:
 *   - If `allProducts` has fewer than `limit` items, we return them all
 *     after bucketing & ordering (no padding).
 *   - If a bucket is empty, we borrow from the next bucket.
 *   - If everything is empty, returns [].
 */
function pickStratifiedPage(allProducts, limit, querySeed, page) {
  if (!Array.isArray(allProducts) || allProducts.length === 0) return [];
  if (!Number.isFinite(limit) || limit <= 0) return [];

  // Sort all candidates by price (ascending) so we can split cleanly.
  const sorted = allProducts.slice().sort((a, b) => priceOf(a) - priceOf(b));

  // Compute bucket boundaries.
  //   - cheap: first 50%
  //   - mid:   next 25%
  //   - expensive: last 25%
  const n = sorted.length;
  const cheapEnd = Math.floor(n * 0.5);
  const midEnd = cheapEnd + Math.floor(n * 0.25);

  const cheapBucket = sorted.slice(0, cheapEnd);
  const midBucket = sorted.slice(cheapEnd, midEnd);
  const expensiveBucket = sorted.slice(midEnd);

  // Determine how many we want from each bucket for this page.
  // 50% / 25% / 25% of the page size, rounded so the total = limit.
  let wantCheap = Math.floor(limit * 0.5);
  let wantMid = Math.floor(limit * 0.25);
  let wantExp = limit - wantCheap - wantMid; // Remainder ensures sum = limit

  // Build a deterministic seed from query + page.
  const seedKey = `${String(querySeed)}|p${page}`;
  const rand = mulberry32(hashStringToInt(seedKey));

  // Sample from each bucket. If a bucket is short, the sampler
  // simply returns fewer items — we'll borrow from the next bucket below.
  const pickCheap = sampleN(cheapBucket, wantCheap, rand);
  const pickMid = sampleN(midBucket, wantMid, rand);
  const pickExp = sampleN(expensiveBucket, wantExp, rand);

  // Calculate how many more we need from each bucket and borrow.
  let needCheap = wantCheap - pickCheap.length;
  let needMid = wantMid - pickMid.length;
  let needExp = wantExp - pickExp.length;

  // Borrow rules (in order):
  //   - If cheap is short, try to top up from mid first, then expensive.
  //   - If mid is short, try to top up from cheap first, then expensive.
  //   - If expensive is short, try to top up from mid first, then cheap.
  // We just refill the deficit by sampling from the remaining pool.
  if (needCheap > 0 || needMid > 0 || needExp > 0) {
    // Collect everything not yet picked.
    const pickedIds = new Set([...pickCheap, ...pickMid, ...pickExp].map((p) => p && p.id));
    const remaining = sorted.filter((p) => !pickedIds.has(p.id));
    shuffleInPlace(remaining, rand);

    // Refill the most-deficient bucket first.
    const deficits = [
      { key: 'cheap',      need: needCheap,     bucket: pickCheap },
      { key: 'mid',        need: needMid,       bucket: pickMid },
      { key: 'expensive',  need: needExp,       bucket: pickExp },
    ].sort((a, b) => b.need - a.need);

    for (const d of deficits) {
      while (d.need > 0 && remaining.length > 0) {
        d.bucket.push(remaining.shift());
        d.need -= 1;
      }
    }
  }

  // Final ordering within each bucket:
  //   - cheap: ascending price (cheapest of the cheap first)
  //   - mid: ascending price
  //   - expensive: descending price (most expensive first)
  pickCheap.sort((a, b) => priceOf(a) - priceOf(b));
  pickMid.sort((a, b) => priceOf(a) - priceOf(b));
  pickExp.sort((a, b) => priceOf(b) - priceOf(a));

  // Concatenate: cheap → mid → expensive, so the page visually
  // tells a "cheapest first, premium last" story.
  return [...pickCheap, ...pickMid, ...pickExp].slice(0, limit);
}

export {
  pickStratifiedPage,
  mulberry32,
  hashStringToInt,
  priceOf,
};

export default {
  pickStratifiedPage,
  mulberry32,
  hashStringToInt,
  priceOf,
};
