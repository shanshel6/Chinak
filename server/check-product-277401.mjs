
import prisma from './prismaClient.js';

async function checkProduct() {
  const product = await prisma.product.findUnique({
    where: { id: 277401 },
    select: {
      id: true,
      name: true,
      aiMetadata: true,
      textEmbedding: true
    }
  });
  console.log('Product 277401 details:');
  console.log('name:', product.name);
  console.log('aiMetadata:', JSON.stringify(product.aiMetadata, null, 2));
  console.log('has textEmbedding:', !!product.textEmbedding);
  await prisma.$disconnect();
}

checkProduct();
