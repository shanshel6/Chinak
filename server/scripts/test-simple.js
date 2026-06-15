import prisma from '../prismaClient.js';

async function test() {
  console.log('Testing database connection...');
  
  try {
    // Test connection by counting products
    const count = await prisma.product.count();
    console.log(`Total products in database: ${count}`);
    
    // Test finding products with single image
    const productsWithSingleImage = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      include: {
        images: {
          select: { id: true, url: true }
        }
      },
      take: 5
    });
    
    console.log('\nSample products:');
    productsWithSingleImage.forEach((product, index) => {
      console.log(`${index + 1}. Product ${product.id}: ${product.name.substring(0, 50)}...`);
      console.log(`   Images: ${product.images.length}`);
      if (product.images.length > 0) {
        console.log(`   First image URL: ${product.images[0].url}`);
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

test().catch(console.error);