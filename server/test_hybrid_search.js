import { hybridSearch } from './services/aiService.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testHybridSearch() {
  console.log('--- Testing Hybrid Search ---');
  
  const testQueries = [
    'كريم مرطب',
    'فستان صيفي',
    'ساعة ذكية'
  ];

  for (const query of testQueries) {
    try {
      console.log(`\nSearching for: "${query}"`);
      const results = await hybridSearch(query, 5);
      
      console.log(`Found ${results.length} results:`);
      results.forEach((p, i) => {
        console.log(`${i+1}. ${p.name} (Score: ${p.final_rank.toFixed(4)})`);
        if (p.embedding) {
          console.error(`ERROR: Product ${p.id} contains embedding column! This should have been excluded.`);
        }
      });
    } catch (error) {
      console.error(`Search failed for "${query}":`, error.message);
      if (error.code === 'P2010') {
        console.error('Prisma Raw Query Error (P2010): Likely still trying to select the vector column.');
      }
    }
  }

  await prisma.$disconnect();
}

testHybridSearch();
