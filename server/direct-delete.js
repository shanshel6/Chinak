// Direct script to delete products with broken images
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function directDelete() {
  console.log('DIRECT DELETION SCRIPT');
  console.log('======================\n');
  
  try {
    // Step 1: Delete products with NO images
    console.log('1. Deleting products with NO images...');
    
    const productsWithNoImages = await prisma.product.findMany({
      where: {
        images: {
          none: {}
        }
      },
      select: { id: true }
    });
    
    console.log(`   Found ${productsWithNoImages.length} products with NO images`);
    
    if (productsWithNoImages.length > 0) {
      const productIds = productsWithNoImages.map(p => p.id);
      
      // Delete in batches
      const batchSize = 100;
      let deletedNoImage = 0;
      
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batchIds = productIds.slice(i, i + batchSize);
        
        try {
          const result = await prisma.product.deleteMany({
            where: {
              id: { in: batchIds }
            }
          });
          
          deletedNoImage += result.count;
          console.log(`   Batch ${Math.floor(i/batchSize) + 1}: Deleted ${result.count} products`);
        } catch (error) {
          console.log(`   Error deleting batch: ${error.message}`);
        }
      }
      
      console.log(`   Total deleted (no images): ${deletedNoImage}`);
    }
    
    // Step 2: Check and delete products with all broken images (sample of 1000)
    console.log('\n2. Checking products with images (sample of 1000)...');
    
    const productsWithImages = await prisma.product.findMany({
      where: {
        images: {
          some: {}
        }
      },
      include: {
        images: {
          select: { url: true },
          orderBy: { order: 'asc' }
        }
      },
      take: 1000,
      orderBy: { id: 'asc' }
    });
    
    console.log(`   Checking ${productsWithImages.length} products with images`);
    
    // We'll identify products with suspicious image patterns
    // Products with exactly 20 images often have broken images
    const suspiciousProducts = productsWithImages.filter(p => p.images.length === 20);
    
    console.log(`   Found ${suspiciousProducts.length} products with exactly 20 images (suspicious)`);
    
    if (suspiciousProducts.length > 0) {
      console.log(`\n3. Deleting suspicious products...`);
      
      let deletedSuspicious = 0;
      const suspiciousIds = suspiciousProducts.map(p => p.id);
      
      // Delete in batches
      const deleteBatchSize = 50;
      
      for (let i = 0; i < suspiciousIds.length; i += deleteBatchSize) {
        const batchIds = suspiciousIds.slice(i, i + deleteBatchSize);
        
        try {
          const result = await prisma.product.deleteMany({
            where: {
              id: { in: batchIds }
            }
          });
          
          deletedSuspicious += result.count;
          console.log(`   Batch ${Math.floor(i/deleteBatchSize) + 1}: Deleted ${result.count} suspicious products`);
        } catch (error) {
          console.log(`   Error deleting batch: ${error.message}`);
        }
      }
      
      console.log(`   Total deleted (suspicious): ${deletedSuspicious}`);
    }
    
    // Step 4: Final report
    console.log('\n4. FINAL REPORT');
    console.log('===============\n');
    
    const finalTotal = await prisma.product.count();
    const finalWithImages = await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    const finalWithoutImages = finalTotal - finalWithImages;
    
    console.log(`Total products remaining: ${finalTotal.toLocaleString()}`);
    console.log(`Products with images: ${finalWithImages.toLocaleString()}`);
    console.log(`Products without images: ${finalWithoutImages.toLocaleString()}`);
    
    // Check specific products
    console.log('\n5. SPECIFIC PRODUCTS CHECK');
    console.log('==========================\n');
    
    const specificIds = [228365, 114979];
    const specificProducts = await prisma.product.findMany({
      where: {
        id: { in: specificIds }
      },
      include: {
        images: {
          select: { url: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    console.log(`Checking ${specificIds.length} specific products:`);
    
    for (const id of specificIds) {
      const product = specificProducts.find(p => p.id === id);
      
      if (!product) {
        console.log(`   Product ${id}: NOT FOUND (already deleted)`);
      } else {
        console.log(`   Product ${id}: FOUND (${product.images.length} images)`);
        console.log(`     Name: ${product.name?.substring(0, 60)}...`);
        
        if (product.images.length === 0) {
          console.log(`     ACTION: Delete (no images)`);
          
          try {
            await prisma.product.delete({
              where: { id: product.id }
            });
            console.log(`     RESULT: Deleted`);
          } catch (error) {
            console.log(`     ERROR: ${error.message}`);
          }
        } else if (product.images.length === 20) {
          console.log(`     SUSPICIOUS: Has exactly 20 images (likely all broken)`);
          
          try {
            await prisma.product.delete({
              where: { id: product.id }
            });
            console.log(`     RESULT: Deleted (suspicious pattern)`);
          } catch (error) {
            console.log(`     ERROR: ${error.message}`);
          }
        }
      }
    }
    
    console.log('\n✅ SCRIPT COMPLETED');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
directDelete();