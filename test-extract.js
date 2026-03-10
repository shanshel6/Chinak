
const cleanStr = (s) => {
  if (!s || typeof s !== 'string') return s || '';
  return s.replace(/\bempty\b/gi, '').trim();
};

const extractGeneratedOptionEntries = (opt) => {
  const out = [];
  if (!opt || typeof opt !== 'object') return out;

  const maybeParseJson = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const metaKeys = new Set(['price', 'image', 'shippingmethod', 'method', 'stock']);

  const pushEntry = (rawKey, rawVal) => {
    const cleanedKey = cleanStr(String(rawKey));
    if (!cleanedKey) return;
    const lower = cleanedKey.toLowerCase();
    if (metaKeys.has(lower)) return;

    if (lower === 'options' || lower === 'combination' || lower === 'variant' || lower === 'variants') {
      const nested = maybeParseJson(rawVal);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const [k, v] of Object.entries(nested)) pushEntry(k, v);
        return;
      }
    }

    out.push([cleanedKey, rawVal]);
  };

  for (const [k, v] of Object.entries(opt)) pushEntry(k, v);
  return out;
};

const testOpt = {
  "price": 11600,
  "combination": { "color": "Beige", "sizes": ["Fixed Base"] },
  "image": "http://example.com/beige.jpg"
};

const extracted = extractGeneratedOptionEntries(testOpt);
console.log('Extracted:', JSON.stringify(extracted, null, 2));

const fieldMapping = {
  'color': 'اللون',
  'sizes': 'المقاس'
};

const dimensionsMap = new Map();
for (const [cleanedKey, rawVal] of extracted) {
  const lower = cleanedKey.toLowerCase();
  const mappedName = (() => {
    if (lower === 'color' || lower === 'colour') return 'اللون';
    if (lower === 'size' || lower === 'sizes') return 'المقاس';
    return fieldMapping[cleanedKey] || cleanedKey;
  })();

  const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
  const cleanedValues = rawValues
    .map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
      return cleanStr(String(v));
    })
    .filter(Boolean);

  if (cleanedValues.length === 0) continue;
  if (!dimensionsMap.has(mappedName)) dimensionsMap.set(mappedName, []);
  dimensionsMap.get(mappedName).push(...cleanedValues);
}

console.log('Dimensions Map:', JSON.stringify([...dimensionsMap.entries()], null, 2));
