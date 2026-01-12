import prisma from './prismaClient.js';

async function checkData() {
  try {
    console.log('--- Database Content Verification ---');
    const products = await prisma.product.findMany();

    console.log(`Total Products in Supabase: ${products.length}`);
    
    products.forEach((p, i) => {
      const hasEmbedding = p.embedding ? 'YES' : 'NO';
      const hasAIStats = p.aiMetadata ? 'YES' : 'NO';
      console.log(`${i+1}. ${p.name.substring(0, 30)}... | AI Embedding: ${hasEmbedding} | AI Tags: ${hasAIStats}`);
    });

  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
