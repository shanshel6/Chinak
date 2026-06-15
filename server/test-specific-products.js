import prisma from './prismaClient.js';
import axios from 'axios';

async function testSpecificProducts() {
  console.log('🔍 Testing specific products: 228365 and 114979\n');
  
  const productIds = [228365, 114979];
  
  try {
    // Fetch the specific products
    const products = await prisma.product.findMany({
      where: {
        id: {
          in: productIds
        }
      },
      include: {
        images: {
          select: { 
            id: true, 
            url: true, 
            order: true
          },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    console.log(`Found ${products.length} products\n`);
    
    const results = [];
    
    for (const product of products) {
      console.log(`📦 Product ID: ${product.id}`);
      console.log(`📝 Name: ${product.name}`);
      console.log(`🖼️  Image count: ${product.images.length}`);
      console.log('');
      
      if (product.images.length === 0) {
        console.log('❌ NO IMAGES - This product should be deleted!');
        results.push({
          productId: product.id,
          status: 'NO_IMAGES',
          action: 'DELETE',
          reason: 'Product has no images'
        });
      } else {
        console.log('📸 Testing image URLs:');
        
        let brokenCount = 0;
        
        for (const image of product.images) {
          console.log(`\n  Image ${image.order + 1} (ID: ${image.id})`);
          console.log(`  URL: ${image.url}`);
          
          try {
            // Test the image URL
            const response = await axios.head(image.url, {
              timeout: 10000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              validateStatus: () => true // Don't throw on any status
            });
            
            console.log(`  Status: ${response.status}`);
            
            if (response.status === 200) {
              console.log(`  ✅ ACCESSIBLE`);
            } else {
              console.log(`  ❌ BROKEN (HTTP ${response.status})`);
              brokenCount++;
            }
            
          } catch (error) {
            console.log(`  ❌ ERROR: ${error.message}`);
            brokenCount++;
          }
        }
        
        console.log('');
        console.log(`📊 Summary for product ${product.id}:`);
        console.log(`  Total images: ${product.images.length}`);
        console.log(`  Broken images: ${brokenCount}`);
        
        if (brokenCount === product.images.length) {
          console.log(`  🗑️  ACTION: DELETE (all images broken)`);
          results.push({
            productId: product.id,
            status: 'ALL_IMAGES_BROKEN',
            action: 'DELETE',
            reason: `All ${product.images.length} images are broken (404)`
          });
        } else if (brokenCount > 0) {
          console.log(`  ⚠️  ACTION: KEEP (some images OK)`);
          results.push({
            productId: product.id,
            status: 'SOME_IMAGES_BROKEN',
            action: 'KEEP',
            reason: `${brokenCount}/${product.images.length} images broken`
          });
        } else {
          console.log(`  ✅ ACTION: KEEP (all images OK)`);
          results.push({
            productId: product.id,
            status: 'ALL_IMAGES_OK',
            action: 'KEEP',
            reason: 'All images are accessible'
          });
        }
      }
      
      console.log('\n' + '─'.repeat(70) + '\n');
    }
    
    // Final summary
    console.log('=== FINAL SUMMARY ===\n');
    
    const deleteCount = results.filter(r => r.action === 'DELETE').length;
    const keepCount = results.filter(r => r.action === 'KEEP').length;
    
    console.log(`Products checked: ${results.length}`);
    console.log(`Products to delete: ${deleteCount}`);
    console.log(`Products to keep: ${keepCount}`);
    console.log('');
    
    for (const result of results) {
      console.log(`Product ${result.productId}: ${result.action} - ${result.reason}`);
    }
    
    console.log('');
    
    if (deleteCount > 0) {
      console.log('⚠️  RECOMMENDATION: Run the cleanup script to delete these products.');
      console.log('   Command: node scripts/fast-image-check.js --delete');
    } else {
      console.log('✅ All tested products have at least one working image.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testSpecificProducts().catch(console.error);