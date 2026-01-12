
const prisma = require('./prismaClient.cjs');
require('dotenv').config();

const getVariations = (word) => {
  const variations = new Set([word]);
  
  const normalize = (w) => w
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '');

  const base = normalize(word);
  variations.add(base);

  if (base.startsWith('ال')) {
    variations.add(base.substring(2));
  } else {
    variations.add('ال' + base);
  }

  if (base.endsWith('يه') || base.endsWith('ية')) {
    variations.add(base.slice(0, -1));
  }
  if (base.endsWith('ي')) {
    variations.add(base + 'ه');
    variations.add(base + 'ة');
  }

  const suffixes = ['ات', 'ون', 'ين'];
  for (const suffix of suffixes) {
    if (base.endsWith(suffix)) {
      variations.add(base.slice(0, -suffix.length));
    }
  }

  if (base.length > 3) {
    variations.add(base + 'ات');
  }

  return Array.from(variations);
};

async function testSearch(q) {
  console.log(`Testing search for: "${q}"`);
  const cleanQuery = q.replace(/[\\\/.,()!?;:]/g, ' ').trim();
  const keywords = cleanQuery.split(/\s+/).filter(k => k.length > 1);
  const allSearchTerms = new Set([q, cleanQuery]);
  keywords.forEach(k => {
    getVariations(k).forEach(v => allSearchTerms.add(v));
  });
  const searchTermsArray = Array.from(allSearchTerms);
  console.log('Search terms:', searchTermsArray);

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: q } },
        ...searchTermsArray.flatMap(term => [
          { name: { contains: term } }
        ])
      ]
    },
    select: { name: true }
  });

  console.log(`Found ${products.length} products:`);
  products.forEach(p => console.log(` - ${p.name}`));
}

async function main() {
  await testSearch('احذيه رجالي');
  await testSearch('احذيه رجاليه');
  await prisma.$disconnect();
}

main();
