import prisma from '../prismaClient.js';

async function test() {
  console.log('Quick test starting...');
  
  try {
    // Test 1: Count products
    const count = await prisma.product.count();
    console.log(`1. Total products: ${count}`);
    
    // Test 2: Count products with single image
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      include: {
        images: {
          select: { id: true }
        }
      },
      take: 10
    });
    
    const singleImageProducts = products.filter(p => p.images.length === 1);
    console.log(`2. First 10 products - ${singleImageProducts.length} have single image`);
    
    // Test 3: Check one product with single image
    if (singleImageProducts.length > 0) {
      const product = singleImageProducts[0];
      const fullProduct = await prisma.product.findUnique({
        where: { id: product.id },
        include: {
          images: {
            select: { url: true }
          }
        }
      });
      
      console.log(`3. Sample product ${fullProduct.id}: ${fullProduct.name.substring(0, 50)}...`);
      console.log(`   Image URL: ${fullProduct.images[0].url}`);
    }
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test().catch(console.error);