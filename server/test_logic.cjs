
const getVariations = (word) => {
  const variations = new Set([word]);
  
  // Basic normalization function
  const normalize = (w) => w
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652]/g, ''); // Remove Harakat

  const base = normalize(word);
  variations.add(base);

  // 1. Iraqi Dialect & Character-level variations
  const generateCharVariations = (w) => {
    let results = [w];
    
    // Alef variations
    const alefs = ['ا', 'أ', 'إ', 'آ'];
    alefs.forEach(a => {
      const currentLen = results.length;
      for (let i = 0; i < currentLen; i++) {
        const item = results[i];
        if (item.includes(a)) {
          alefs.forEach(targetA => {
            results.push(item.replace(new RegExp(a, 'g'), targetA));
          });
        }
      }
    });

    // Teh Marbuta / Heh variations
    const tehs = ['ة', 'ه'];
    tehs.forEach(t => {
      const currentLen = results.length;
      for (let i = 0; i < currentLen; i++) {
        const item = results[i];
        if (item.endsWith(t)) {
          tehs.forEach(targetT => {
            results.push(item.slice(0, -1) + targetT);
          });
        }
      }
    });

    // Yeh / Alef Maqsura variations
    const yehs = ['ي', 'ى'];
    yehs.forEach(y => {
      const currentLen = results.length;
      for (let i = 0; i < currentLen; i++) {
        const item = results[i];
        if (item.endsWith(y)) {
          yehs.forEach(targetY => {
            results.push(item.slice(0, -1) + targetY);
          });
        }
      }
    });

    // Iraqi / Persian / Urdu character mappings to Standard Arabic
    // گ (Gaf) -> ق or ك
    // چ (Che) -> ج or ك
    // پ (Pe) -> ب
    // ڤ (Ve) -> ف
    const currentLenBeforeIraqi = results.length;
    for (let i = 0; i < currentLenBeforeIraqi; i++) {
      const item = results[i];
      if (item.includes('گ')) {
        results.push(item.replace(/گ/g, 'ق'));
        results.push(item.replace(/گ/g, 'ك'));
      }
      if (item.includes('چ')) {
        results.push(item.replace(/چ/g, 'ج'));
        results.push(item.replace(/چ/g, 'ك'));
      }
      if (item.includes('پ')) results.push(item.replace(/پ/g, 'ب'));
      if (item.includes('ڤ')) results.push(item.replace(/ڤ/g, 'ف'));
      
      // Phonetic swaps common in Iraqi dialect
      // Qaf (ق) often pronounced/typed as Gaf or even G (ق -> ك sometimes in typing)
      if (item.includes('ق')) results.push(item.replace(/ق/g, 'ك'));
      if (item.includes('ك')) results.push(item.replace(/ك/g, 'ق'));
    }

    return Array.from(new Set(results));
  };

  // Apply character variations
  generateCharVariations(word).forEach(v => variations.add(v));
  generateCharVariations(base).forEach(v => variations.add(v));

  // 2. Handle Common Prefixes (ال، و، ب)
  const currentTermsForPrefix = Array.from(variations);
  currentTermsForPrefix.forEach(v => {
    // Al- (ال)
    if (v.startsWith('ال')) {
      variations.add(v.substring(2));
    } else if (v.length > 2) {
      variations.add('ال' + v);
    }
    
    // W- (و) conjunction
    if (v.startsWith('و') && v.length > 3) {
      variations.add(v.substring(1));
    }
    
    // Bi- (ب) preposition (common in Iraqi)
    if (v.startsWith('ب') && v.length > 3) {
      variations.add(v.substring(1));
    }
  });

  // 3. Handle Common Suffixes (Plurals, Gender, Possessives)
  const currentTermsForSuffix = Array.from(variations);
  currentTermsForSuffix.forEach(v => {
    // Feminine/Adjective suffixes: 'يه', 'ية' -> 'ي'
    if (v.endsWith('يه') || v.endsWith('ية')) {
      variations.add(v.slice(0, -2));
      variations.add(v.slice(0, -2) + 'ي');
      variations.add(v.slice(0, -1)); // Keep base but change teh to heh/vice versa via variations
    }
    
    // 'ي' -> 'يه', 'ية' (e.g., رجالي -> رجاليه)
    if (v.endsWith('ي')) {
      variations.add(v + 'ه');
      variations.add(v + 'ة');
    }

    // Plural suffixes: 'ات', 'ون', 'ين', 'ية'
    const pluralSuffixes = ['ات', 'ون', 'ين', 'ية'];
    for (const suffix of pluralSuffixes) {
      if (v.endsWith(suffix) && v.length > suffix.length + 2) {
        variations.add(v.slice(0, -suffix.length));
      }
    }

    // Iraqi specific plural/possessive or common endings
    if (v.length > 3 && !v.endsWith('ات')) {
      variations.add(v + 'ات');
    }
    
    if (v.endsWith('نا') && v.length > 4) variations.add(v.slice(0, -2));
    if (v.endsWith('كم') && v.length > 4) variations.add(v.slice(0, -2));
  });

  // 4. Final step: ensure all generated terms are normalized
  const finalVariations = new Set();
  variations.forEach(v => {
    if (v && v.length > 1) {
      finalVariations.add(v);
      finalVariations.add(normalize(v));
    }
  });

  return Array.from(finalVariations);
};

const wordsToTest = ['گول', 'چاي', 'بگلياتي', 'احذيه', 'دشداشه'];
wordsToTest.forEach(testWord => {
  console.log(`\nVariations for "${testWord}":`);
  const variations = getVariations(testWord);
  console.log(variations.slice(0, 15), variations.length > 15 ? `... and ${variations.length - 15} more` : '');
});
