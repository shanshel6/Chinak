// Network-only debug for the "مفتاح" issue.
// Run with:  node debug/check_search_http.mjs
//
// Hits the live production server over HTTPS, so you don't need
// any DB credentials. It will tell us:
//   1. What the server-side translation of "مفتاح" returns
//   2. What textEmbedding-based search returns for both the
//      translated word AND the literal English word "switch"
//   3. How good the top match similarity is (if < 0.45 it's a miss)

import https from 'node:https';

const BASE = 'https://chinak-production.up.railway.app';

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      `${BASE}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch (e) {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function translate(text) {
  const r = await postJson('/api/translate/arabic-to-english', { text });
  return r.body?.translated ?? r.body;
}

async function search(englishText) {
  // The server exposes /api/products/search-by-photo?search=...
  // It will generate an embedding on the server using the SAME
  // model that produced the product textEmbeddings, so it's the
  // cleanest way to test what the DB actually returns for this word.
  const r = await new Promise((resolve, reject) => {
    const url = `${BASE}/api/products/search-by-photo?search=${encodeURIComponent(englishText)}&page=1&limit=5`;
    https.get(url, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch (e) {
          resolve({ status: res.statusCode, body: buf });
        }
      });
    }).on('error', reject);
  });
  return r.body;
}

async function main() {
  console.log('='.repeat(70));
  console.log('STEP 1  server-side translation of "مفتاح"');
  console.log('='.repeat(70));
  const t = await translate('مفتاح');
  console.log('   →', JSON.stringify(t));

  console.log('\n' + '='.repeat(70));
  console.log('STEP 2  server-side search using that translation');
  console.log('='.repeat(70));
  const r1 = await search(t);
  const prods1 = Array.isArray(r1?.products) ? r1.products : [];
  console.log(`   engine=${r1?.engine}  total=${r1?.total}  returned=${prods1.length}`);
  for (const p of prods1) {
    console.log(`     id=${p.id}  sim=${Number(p.similarity ?? p.imageSimilarity ?? 0).toFixed(4)}  name=${JSON.stringify(p.name).slice(0, 80)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('STEP 3  server-side search using literal English words');
  console.log('='.repeat(70));
  for (const w of ['switch', 'electric switch', 'light switch', 'key', 'wrench', 'pet comb']) {
    const r = await search(w);
    const prods = Array.isArray(r?.products) ? r.products : [];
    console.log(`\n   query="${w}"  engine=${r?.engine}  total=${r?.total}`);
    for (const p of prods.slice(0, 3)) {
      console.log(`     id=${p.id}  sim=${Number(p.similarity ?? p.imageSimilarity ?? 0).toFixed(4)}  name=${JSON.stringify(p.name).slice(0, 80)}`);
    }
  }
}

main().catch((e) => {
  console.error('debug failed:', e);
  process.exit(1);
});