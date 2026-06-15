import prisma from '../prismaClient.js';

async function checkSpecificProducts(productIds) {
  console.log(`🔍 Checking specific products: ${productIds.join(', ')}\n`);
  
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
            order: true,
            type: true
          },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    console.log(`Found ${products.length} products\n`);
    
    // Patterns to check for bad images
    const badPatterns = [
      /_Q90\.jpg_$/,
      /~livephoto~/,
      /tps-48-48/,
      /placeholder/i,
      /blank/i,
      /white\.(jpg|png|gif|webp)$/i,
      /1x1\.(jpg|png|gif|webp)$/i,
      /pixel\.(jpg|png|gif|webp)$/i,
      /transparent\.(jpg|png|gif|webp)$/i,
    ];
    
    function isBadImage(url) {
      if (!url || url.trim() === '') return true;
      return badPatterns.some(pattern => pattern.test(url));
    }
    
    for (const product of products) {
      console.log(`=== Product ID: ${product.id} ===`);
      console.log(`Name: ${product.name}`);
      console.log(`Status: ${product.status}`);
      console.log(`Active: ${product.isActive}`);
      console.log(`Main image field: ${product.image || '(empty)'}`);
      console.log(`Number of images: ${product.images.length}`);
      console.log(`Created: ${product.createdAt.toISOString()}`);
      console.log(`Updated: ${product.updatedAt.toISOString()}`);
      console.log('');
      
      if (product.images.length === 0) {
        console.log('❌ No images found for this product!');
      } else {
        console.log('📸 Product Images:');
        
        for (const image of product.images) {
          const bad = isBadImage(image.url);
          console.log(`\n  Image ID: ${image.id}`);
          console.log(`  Order: ${image.order}`);
          console.log(`  Type: ${image.type}`);
          console.log(`  URL: ${image.url}`);
          console.log(`  Is bad image: ${bad ? 'YES ⚠️' : 'No ✅'}`);
          
          if (bad) {
            console.log(`  Bad pattern detected in URL`);
          }
        }
      }
      
      console.log('\n' + '─'.repeat(50) + '\n');
    }
    
    // Summary
    console.log('=== SUMMARY ===\n');
    
    for (const product of products) {
      const badImages = product.images.filter(img => isBadImage(img.url));
      console.log(`Product ${product.id}:`);
      console.log(`  Total images: ${product.images.length}`);
      console.log(`  Bad images: ${badImages.length}`);
      console.log(`  Has images: ${product.images.length > 0 ? 'Yes' : 'No'}`);
      console.log(`  All images bad: ${badImages.length === product.images.length && product.images.length > 0 ? 'YES ⚠️' : 'No'}`);
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Check specific products
const productIdsToCheck = [228365, 114979];
checkSpecificProducts(productIdsToCheck).catch(console.error);