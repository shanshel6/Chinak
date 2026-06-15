import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function delete500Broken() {
  console.log('🔍 CHECKING AND DELETING BROKEN IMAGE PRODUCTS (500 sample)\n');
  
  try {
    // Get 500 products with images
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
      take: 500,
      orderBy: { id: 'asc' }
    });
    
    console.log(`📊 Checking ${products.length.toLocaleString()} products\n`);
    
    let totalImages = 0;
    let brokenImages = 0;
    let accessibleImages = 0;
    const productsToDelete = [];
    const productsWithSomeBroken = [];
    
    // Check each product
    for (const product of products) {
      totalImages += product.images.length;
      let productBrokenCount = 0;
      let productAccessibleCount = 0;
      
      // Check each image
      for (const image of product.images) {
        try {
          const response = await axios.head(image.url, {
            timeout: 3000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
          });
          
          if (response.status === 200) {
            accessibleImages++;
            productAccessibleCount++;
          } else {
            brokenImages++;
            productBrokenCount++;
          }
        } catch (error) {
          brokenImages++;
          productBrokenCount++;
        }
      }
      
      // If all images are broken, mark for deletion
      if (product.images.length > 0 && productBrokenCount === product.images.length) {
        productsToDelete.push({
          id: product.id,
          name: product.name,
          imageCount: product.images.length
        });
      }
      
      // If some images are broken but not all
      if (productBrokenCount > 0 && productAccessibleCount > 0) {
        productsWithSomeBroken.push({
          id: product.id,
          name: product.name,
          brokenCount: productBrokenCount,
          totalCount: product.images.length
        });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 CHECK RESULTS:');
    console.log('='.repeat(60));
    console.log(`Total products checked: ${products.length.toLocaleString()}`);
    console.log(`Total images checked: ${totalImages.toLocaleString()}`);
    console.log(`Accessible images: ${accessibleImages.toLocaleString()} (${totalImages > 0 ? ((accessibleImages / totalImages) * 100).toFixed(1) : 0}%)`);
    console.log(`Broken images: ${brokenImages.toLocaleString()} (${totalImages > 0 ? ((brokenImages / totalImages) * 100).toFixed(1) : 0}%)`);
    console.log(`Products with ALL broken images: ${productsToDelete.length.toLocaleString()}`);
    console.log(`Products with SOME broken images: ${productsWithSomeBroken.length.toLocaleString()}`);
    
    // Now delete the products with all broken images
    console.log('\n' + '='.repeat(60));
    console.log('🗑️  DELETING PRODUCTS:');
    console.log('='.repeat(60));
    
    let deletedCount = 0;
    
    if (productsToDelete.length > 0) {
      console.log(`Deleting ${productsToDelete.length} products with all broken images...\n`);
      
      for (const product of productsToDelete) {
        try {
          await prisma.product.delete({
            where: { id: product.id }
          });
          
          deletedCount++;
          console.log(`✅ Deleted product ${product.id}: "${product.name?.substring(0, 50)}..." (${product.imageCount} images)`);
        } catch (error) {
          console.log(`❌ Error deleting product ${product.id}: ${error.message}`);
        }
      }
    } else {
      console.log('No products found with ALL broken images.');
    }
    
    // Also delete products with NO images at all (from the first 500)
    console.log('\n' + '='.repeat(60));
    console.log('🗑️  DELETING PRODUCTS WITH NO IMAGES:');
    console.log('='.repeat(60));
    
    const productsWithNoImages = await prisma.product.findMany({
      where: {
        images: {
          none: {}
        }
      },
      take: 100,
      select: { id: true, name: true }
    });
    
    console.log(`Found ${productsWithNoImages.length} products with NO images (first 100)`);
    
    let noImageDeleted = 0;
    if (productsWithNoImages.length > 0) {
      for (const product of productsWithNoImages) {
        try {
          await prisma.product.delete({
            where: { id: product.id }
          });
          
          noImageDeleted++;
          console.log(`✅ Deleted product ${product.id} (no images)`);
        } catch (error) {
          console.log(`❌ Error deleting product ${product.id}: ${error.message}`);
        }
      }
    }
    
    // Final statistics
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL RESULTS:');
    console.log('='.repeat(60));
    console.log(`Products deleted (all images broken): ${deletedCount.toLocaleString()}`);
    console.log(`Products deleted (no images): ${noImageDeleted.toLocaleString()}`);
    console.log(`Total deleted: ${(deletedCount + noImageDeleted).toLocaleString()}`);
    
    // Check the specific products mentioned by user
    console.log('\n' + '='.repeat(60));
    console.log('🔍 CHECKING SPECIFIC PRODUCTS (228365, 114979):');
    console.log('='.repeat(60));
    
    const specificProducts = await prisma.product.findMany({
      where: {
        id: { in: [228365, 114979] }
      },
      include: {
        images: {
          select: { url: true, id: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    for (const product of specificProducts) {
      console.log(`\nProduct ID: ${product.id}`);
      console.log(`Name: ${product.name?.substring(0, 80)}...`);
      console.log(`Image count: ${product.images.length}`);
      
      if (product.images.length === 0) {
        console.log(`❌ NO IMAGES - This product should be deleted!`);
        
        // Try to delete it
        try {
          await prisma.product.delete({
            where: { id: product.id }
          });
          console.log(`✅ Deleted product ${product.id}`);
        } catch (error) {
          console.log(`❌ Error deleting: ${error.message}`);
        }
      } else {
        // Check first image
        const image = product.images[0];
        try {
          const response = await axios.head(image.url, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
          });
          
          if (response.status === 200) {
            console.log(`✅ First image accessible (Status: ${response.status})`);
          } else {
            console.log(`❌ First image broken (Status: ${response.status})`);
            
            // Check if all images are broken
            let allBroken = true;
            for (const img of product.images) {
              try {
                const imgResponse = await axios.head(img.url, {
                  timeout: 3000,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                  },
                  validateStatus: () => true
                });
                
                if (imgResponse.status === 200) {
                  allBroken = false;
                  break;
                }
              } catch {
                // Error means broken
              }
            }
            
            if (allBroken) {
              console.log(`⚠️  ALL images broken - Deleting product...`);
              try {
                await prisma.product.delete({
                  where: { id: product.id }
                });
                console.log(`✅ Deleted product ${product.id}`);
              } catch (error) {
                console.log(`❌ Error deleting: ${error.message}`);
              }
            }
          }
        } catch (error) {
          console.log(`❌ Error checking image: ${error.message}`);
        }
      }
    }
    
    // Estimated totals based on 500 product sample
    const brokenImageRate = totalImages > 0 ? (brokenImages / totalImages) : 0;
    const productDeletionRate = products.length > 0 ? (productsToDelete.length / products.length) : 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 ESTIMATED TOTALS (based on 500 product sample):');
    console.log('='.repeat(60));
    console.log(`Broken image rate: ${(brokenImageRate * 100).toFixed(1)}%`);
    console.log(`Product deletion rate: ${(productDeletionRate * 100).toFixed(1)}%`);
    
    if (brokenImageRate > 0) {
      console.log(`\n💡 Based on this sample, you should run the full cleanup script:`);
      console.log(`   node scripts/delete-broken-image-products.js --delete`);
      console.log(`\n   Or use the batch file:`);
      console.log(`   e:\\mynewproject2\\fix-broken-images.bat delete`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check and deletion
delete500Broken();