import prisma from '../prismaClient.js';
import axios from 'axios';

async function testImageUrls(productIds) {
  console.log(`🖼️ Testing image URLs for products: ${productIds.join(', ')}\n`);
  
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
    
    console.log(`=== IMAGE URL TEST RESULTS ===\n`);
    
    const results = [];
    
    for (const product of products) {
      console.log(`📦 Product ID: ${product.id}`);
      console.log(`📝 Name: ${product.name.substring(0, 60)}...`);
      console.log(`🖼️  Image count: ${product.images.length}`);
      console.log('');
      
      if (product.images.length === 0) {
        console.log('❌ NO IMAGES');
        results.push({
          productId: product.id,
          status: 'NO_IMAGES',
          imageUrl: null,
          details: 'Product has no images'
        });
      } else {
        console.log('📸 Testing image URLs:');
        
        for (const image of product.images) {
          console.log(`\n  Image #${image.order + 1} (ID: ${image.id})`);
          console.log(`  URL: ${image.url}`);
          
          try {
            // Test the image URL
            const response = await axios.head(image.url, {
              timeout: 10000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            const status = response.status;
            const contentType = response.headers['content-type'] || 'unknown';
            const contentLength = response.headers['content-length'] || 'unknown';
            
            console.log(`  ✅ Accessible - Status: ${status}`);
            console.log(`     Content-Type: ${contentType}`);
            console.log(`     Content-Length: ${contentLength} bytes`);
            
            if (status === 200) {
              results.push({
                productId: product.id,
                status: 'OK',
                imageUrl: image.url,
                details: `Status: ${status}, Type: ${contentType}, Size: ${contentLength} bytes`
              });
            } else {
              results.push({
                productId: product.id,
                status: 'UNEXPECTED_STATUS',
                imageUrl: image.url,
                details: `Unexpected status: ${status}`
              });
            }
            
          } catch (error) {
            console.log(`  ❌ Failed to access`);
            
            if (error.response) {
              // Server responded with error status
              console.log(`     Status: ${error.response.status}`);
              console.log(`     Error: ${error.response.statusText}`);
              
              results.push({
                productId: product.id,
                status: 'HTTP_ERROR',
                imageUrl: image.url,
                details: `HTTP ${error.response.status}: ${error.response.statusText}`
              });
            } else if (error.request) {
              // Request made but no response
              console.log(`     No response received`);
              console.log(`     Error: ${error.message}`);
              
              results.push({
                productId: product.id,
                status: 'NO_RESPONSE',
                imageUrl: image.url,
                details: `No response: ${error.message}`
              });
            } else {
              // Other errors
              console.log(`     Error: ${error.message}`);
              
              results.push({
                productId: product.id,
                status: 'OTHER_ERROR',
                imageUrl: image.url,
                details: `Error: ${error.message}`
              });
            }
          }
        }
      }
      
      console.log('\n' + '─'.repeat(70) + '\n');
    }
    
    // Summary
    console.log('=== SUMMARY ===\n');
    
    const totalProducts = results.length;
    const okProducts = results.filter(r => r.status === 'OK').length;
    const errorProducts = results.filter(r => r.status !== 'OK').length;
    
    console.log(`Total products checked: ${totalProducts}`);
    console.log(`Products with accessible images: ${okProducts}`);
    console.log(`Products with image issues: ${errorProducts}`);
    console.log('');
    
    // Display image URLs
    console.log('=== IMAGE URLs ===\n');
    
    for (const result of results) {
      if (result.imageUrl) {
        console.log(`Product ${result.productId}:`);
        console.log(`  URL: ${result.imageUrl}`);
        console.log(`  Status: ${result.status}`);
        console.log(`  Details: ${result.details}`);
        console.log('');
      }
    }
    
    // Recommendations
    console.log('=== RECOMMENDATIONS ===\n');
    
    if (errorProducts > 0) {
      console.log('⚠️  Some images may have issues. Recommended actions:');
      console.log('1. Check if image URLs are accessible in browser');
      console.log('2. Verify CDN/Image hosting service is working');
      console.log('3. Check for CORS issues');
      console.log('4. Test on different networks/devices');
      console.log('5. Consider replacing broken images');
    } else {
      console.log('✅ All tested images appear to be accessible.');
      console.log('If images still appear white/blank in the app, check:');
      console.log('1. Browser DevTools Network tab for errors');
      console.log('2. CORS headers on image server');
      console.log('3. Ad blockers or browser extensions');
      console.log('4. Network connectivity issues');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Test specific products
const productIdsToTest = [228365, 114979];
testImageUrls(productIdsToTest).catch(console.error);