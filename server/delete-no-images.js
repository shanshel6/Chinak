import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteProductsWithNoImages() {
  console.log('🗑️  DELETING PRODUCTS WITH NO IMAGES\n');
  
  try {
    // First, count how many products have no images
    const totalProducts = await prisma.product.count();
    const productsWithImages = await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    const productsWithoutImages = totalProducts - productsWithImages;
    
    console.log(`Total products: ${totalProducts.toLocaleString()}`);
    console.log(`Products with images: ${productsWithImages.toLocaleString()}`);
    console.log(`Products WITHOUT images: ${productsWithoutImages.toLocaleString()}`);
    
    if (productsWithoutImages === 0) {
      console.log('\n✅ No products without images found.');
      return;
    }
    
    console.log(`\n🚨 DELETING ${productsWithoutImages.toLocaleString()} products with NO images...\n`);
    
    // Get the IDs of products with no images
    const productsToDelete = await prisma.product.findMany({
      where: {
        images: {
          none: {}
        }
      },
      select: { id: true },
      orderBy: { id: 'asc' }
    });
    
    console.log(`Found ${productsToDelete.length} products to delete.`);
    
    // Delete in batches to avoid timeout
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < productsToDelete.length; i += batchSize) {
      const batchIds = productsToDelete.slice(i, i + batchSize).map(p => p.id);
      
      try {
        const result = await prisma.product.deleteMany({
          where: {
            id: { in: batchIds }
          }
        });
        
        deletedCount += result.count;
        console.log(`   Batch ${Math.floor(i/batchSize) + 1}: Deleted ${result.count} products`);
        
      } catch (error) {
        console.log(`   Error deleting batch ${Math.floor(i/batchSize) + 1}: ${error.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ DELETION COMPLETE');
    console.log('='.repeat(50));
    console.log(`Total deleted: ${deletedCount.toLocaleString()}`);
    
    // Verify deletion
    const remainingTotal = await prisma.product.count();
    const remainingWithoutImages = remainingTotal - await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    
    console.log(`\n📊 VERIFICATION:`);
    console.log(`Remaining total products: ${remainingTotal.toLocaleString()}`);
    console.log(`Remaining products without images: ${remainingWithoutImages.toLocaleString()}`);
    
    if (remainingWithoutImages === 0) {
      console.log('\n🎉 SUCCESS! All products without images have been deleted.');
    } else {
      console.log(`\n⚠️  WARNING: ${remainingWithoutImages} products without images still exist.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the deletion
deleteProductsWithNoImages();