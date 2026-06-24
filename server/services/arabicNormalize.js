// Shared Arabic text normalizer.
//
// MUST be used identically at index time (building Product.nameNormalized) and
// at query time (normalizing the user's typed query). If the two ever diverge,
// lexical search silently stops matching. Keep this the single source of truth.

// Arabic diacritics (harakat) + tatweel/kashida.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;

// Arabic-Indic and Eastern Arabic-Indic digits -> ASCII.
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

function mapDigits(str) {
  let out = '';
  for (const ch of str) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a !== -1) { out += String(a); continue; }
    const e = EXT_ARABIC_INDIC.indexOf(ch);
    if (e !== -1) { out += String(e); continue; }
    out += ch;
  }
  return out;
}

/**
 * Normalize Arabic (and mixed Arabic/Latin) text for lexical matching.
 * Returns a lowercased, diacritic-free, hamza/ta-marbuta/alef-maksura-folded
 * string with ASCII digits and collapsed whitespace.
 */
export function normalizeArabic(input) {
  if (input == null) return '';
  let s = String(input);

  s = s.normalize('NFKC');
  s = s.replace(DIACRITICS, '');
  s = s.replace(TATWEEL, '');
  s = mapDigits(s);

  // Hamza / alef variants -> bare alef
  s = s.replace(/[آأإٱ]/g, 'ا'); // آ أ إ ٱ -> ا
  s = s.replace(/[ؤ]/g, 'و');                   // ؤ -> و
  s = s.replace(/[ئ]/g, 'ي');                   // ئ -> ي
  s = s.replace(/[ة]/g, 'ه');                   // ة -> ه
  s = s.replace(/[ى]/g, 'ي');                   // ى -> ي
  s = s.replace(/[ـ]/g, '');                          // any stray tatweel

  s = s.toLowerCase();
  // Keep Arabic letters, Latin letters/digits, spaces; turn other punctuation into spaces.
  s = s.replace(/[^ء-يa-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Split a normalized query into distinct, meaningful terms. */
export function normalizedTerms(input) {
  const norm = normalizeArabic(input);
  if (!norm) return [];
  const seen = new Set();
  const terms = [];
  for (const t of norm.split(' ')) {
    if (t.length < 2) continue; // drop single-char noise
    if (seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
  }
  return terms;
}
