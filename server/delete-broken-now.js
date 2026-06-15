import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function deleteBrokenProducts() {
  console.log('🚨 DELETING PRODUCTS WITH BROKEN IMAGES\n');
  console.log('This will delete products where ALL images return 404 status.\n');
  
  try {
    // First, let's check how many products we have
    const totalProducts = await prisma.product.count();
    console.log(`Total products in database: ${totalProducts.toLocaleString()}`);
    
    // Get products with images (we'll check a batch first)
    const batchSize = 100;
    let offset = 0;
    let totalDeleted = 0;
    let totalChecked = 0;
    
    console.log(`\nChecking products in batches of ${batchSize}...\n`);
    
    while (offset < totalProducts) {
      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          status: 'PUBLISHED',
          images: {
            some: {}
          }
        },
        include: {
          images: {
            select: { url: true, id: true },
            orderBy: { order: 'asc' }
          }
        },
        skip: offset,
        take: batchSize,
        orderBy: { id: 'asc' }
      });
      
      if (products.length === 0) break;
      
      console.log(`Checking batch ${Math.floor(offset/batchSize) + 1} (products ${offset + 1} to ${offset + products.length})...`);
      
      for (const product of products) {
        totalChecked++;
        
        // Check if all images are broken
        let allBroken = true;
        let checkedImages = 0;
        
        for (const image of product.images) {
          try {
            const response = await axios.head(image.url, {
              timeout: 3000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              validateStatus: () => true
            });
            
            checkedImages++;
            
            if (response.status === 200) {
              allBroken = false;
              break; // Found at least one good image
            }
          } catch (error) {
            // If error, assume broken
            checkedImages++;
          }
        }
        
        // If we checked all images and all are broken, delete the product
        if (allBroken && checkedImages === product.images.length && product.images.length > 0) {
          console.log(`❌ Deleting product ${product.id} (all ${product.images.length} images broken)`);
          
          try {
            // Delete the product (this will cascade delete images)
            await prisma.product.delete({
              where: { id: product.id }
            });
            
            totalDeleted++;
          } catch (deleteError) {
            console.log(`   Error deleting product ${product.id}: ${deleteError.message}`);
          }
        }
        
        // Show progress every 50 products
        if (totalChecked % 50 === 0) {
          console.log(`   Progress: ${totalChecked.toLocaleString()} checked, ${totalDeleted.toLocaleString()} deleted`);
        }
      }
      
      offset += batchSize;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ DELETION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total products checked: ${totalChecked.toLocaleString()}`);
    console.log(`Total products deleted: ${totalDeleted.toLocaleString()}`);
    console.log(`Remaining products: ${(totalProducts - totalDeleted).toLocaleString()}`);
    
    // Also delete products with NO images at all
    console.log('\n' + '='.repeat(60));
    console.log('🗑️  Deleting products with NO images...');
    console.log('='.repeat(60));
    
    const productsWithNoImages = await prisma.product.findMany({
      where: {
        images: {
          none: {}
        }
      },
      select: { id: true }
    });
    
    console.log(`Found ${productsWithNoImages.length} products with NO images`);
    
    if (productsWithNoImages.length > 0) {
      const productIds = productsWithNoImages.map(p => p.id);
      
      // Delete in batches to avoid timeout
      const deleteBatchSize = 100;
      let noImageDeleted = 0;
      
      for (let i = 0; i < productIds.length; i += deleteBatchSize) {
        const batchIds = productIds.slice(i, i + deleteBatchSize);
        
        try {
          await prisma.product.deleteMany({
            where: {
              id: { in: batchIds }
            }
          });
          
          noImageDeleted += batchIds.length;
          console.log(`   Deleted batch ${Math.floor(i/deleteBatchSize) + 1}: ${batchIds.length} products`);
        } catch (error) {
          console.log(`   Error deleting batch: ${error.message}`);
        }
      }
      
      console.log(`\n✅ Deleted ${noImageDeleted} products with NO images`);
    }
    
    // Final statistics
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL STATISTICS');
    console.log('='.repeat(60));
    
    const finalTotal = await prisma.product.count();
    const productsWithImages = await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    
    console.log(`Total products remaining: ${finalTotal.toLocaleString()}`);
    console.log(`Products with images: ${productsWithImages.toLocaleString()}`);
    console.log(`Products without images: ${(finalTotal - productsWithImages).toLocaleString()}`);
    
    if (totalDeleted > 0 || productsWithNoImages.length > 0) {
      console.log(`\n🎉 Cleanup successful! Database is now cleaner.`);
    } else {
      console.log(`\nℹ️  No products needed to be deleted.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the deletion
deleteBrokenProducts();