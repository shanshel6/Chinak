
// Simple test script to verify vector parsing and search (no server needed)
import { embedText } from './services/clipService.js';
import { searchProductsByHybridVector } from './services/productImageVectorService.js';
import prisma from './prismaClient.js';

console.log('Testing vector search...');

const testQuery = 'black sports shoes';

console.log(`Generating embedding for "${testQuery}"...`);
const testEmbedding = await embedText(testQuery);
console.log('Generated 512-dimensional vector!');

console.log('\nSearching products...');
const results = await searchProductsByHybridVector(prisma, testEmbedding, null, 3, 0);
console.log(`Found ${results.length} products!`);
console.log('Top results:', results.map(r => ({id: r.id, similarity: r.similarity})));

await prisma.$disconnect();
