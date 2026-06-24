// Search quality eval harness for the hybrid Arabic search.
//
// Runs a golden set of Arabic queries through the EXACT production path
// (searchHybridText) and reports, per query, the rank of the first relevant
// result plus aggregate MRR and Recall@10. A result is "relevant" if its
// normalized name contains the `mustContain` terms (a cheap, deterministic
// proxy for "is this the kind of product the user wanted").
//
// Usage:  node scripts/search-eval.mjs
//
// Treat a regression in MRR / Recall@10 as a search-quality bug.
import prisma from '../prismaClient.js';
import { embedText } from '../services/clipService.js';
import { searchHybridText } from '../services/productImageVectorService.js';
import { normalizeArabic } from '../services/arabicNormalize.js';

// ar  = what the user types
// en  = the English the device's translate step produces (drives the CLIP vector)
// mustContain = normalized tokens a result MUST all contain to count as relevant
const GOLDEN = [
  { ar: 'سخان مياه',        en: 'water heater',          mustContain: ['سخان', 'مياه'] },
  { ar: 'سخان مياه ميديا',  en: 'Midea water heater',    mustContain: ['سخان', 'مياه', 'ميديا'] },
  { ar: 'سخان مياه هاير',   en: 'Haier water heater',    mustContain: ['سخان', 'مياه'] },
  { ar: 'فلتر مياه',        en: 'water filter',          mustContain: ['فلتر', 'مياه'] },
  { ar: 'خلاط مياه',        en: 'water mixer faucet',    mustContain: ['خلاط'] },
  { ar: 'غلاية كهربائية',   en: 'electric kettle',       mustContain: ['غلايه'] },
  { ar: 'سماعات',           en: 'headphones',            mustContain: ['سماع'] },
  { ar: 'ساعة',             en: 'watch',                 mustContain: ['ساع'] },
];

const TOPN = 10;

function isRelevant(name, mustContain) {
  const n = normalizeArabic(name);
  return mustContain.every((t) => n.includes(normalizeArabic(t)));
}

async function namesFor(ids) {
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Product" WHERE id = ANY($1::int[])`, ids
  );
  return new Map(rows.map((r) => [Number(r.id), r.name]));
}

async function main() {
  let sumRR = 0;
  let hitAt10 = 0;
  console.log(`Hybrid search eval — ${GOLDEN.length} queries, top ${TOPN}\n`);

  for (const g of GOLDEN) {
    const vec = await embedText(g.en);
    const hits = await searchHybridText(prisma, vec, g.ar, TOPN, 0);
    const names = await namesFor(hits.map((h) => h.id));

    let firstRel = 0;
    for (let i = 0; i < hits.length; i++) {
      if (isRelevant(names.get(hits[i].id) || '', g.mustContain)) { firstRel = i + 1; break; }
    }
    const rr = firstRel ? 1 / firstRel : 0;
    sumRR += rr;
    if (firstRel && firstRel <= 10) hitAt10++;

    const top = names.get(hits[0]?.id);
    const verdict = firstRel === 1 ? '✅ #1' : firstRel ? `⚠️  #${firstRel}` : '❌ miss';
    console.log(`${verdict.padEnd(8)} "${g.ar}"`);
    console.log(`         top1: ${top ? String(top).slice(0, 55) : '(none)'}`);
  }

  console.log(`\n──────────────────────────────`);
  console.log(`MRR:        ${(sumRR / GOLDEN.length).toFixed(3)}`);
  console.log(`Recall@10:  ${(hitAt10 / GOLDEN.length).toFixed(3)}  (${hitAt10}/${GOLDEN.length})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
