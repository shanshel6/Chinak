import prisma from '../prismaClient.js';

async function analyzeProductImages(productIds) {
  console.log(`🔍 Analyzing images for products: ${productIds.join(', ')}\n`);
  
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
    
    console.log(`=== IMAGE ANALYSIS ===\n`);
    
    for (const product of products) {
      console.log(`📦 Product ID: ${product.id}`);
      console.log(`📝 Name: ${product.name}`);
      console.log(`🖼️  Total images: ${product.images.length}`);
      console.log('');
      
      if (product.images.length === 0) {
        console.log('❌ NO IMAGES FOUND - This product has no images!');
      } else {
        console.log('📸 Image Details:');
        
        for (const image of product.images) {
          console.log(`\n  Image #${image.order + 1} (ID: ${image.id})`);
          console.log(`  URL: ${image.url}`);
          
          // Analyze the URL
          const url = image.url;
          const filename = url.split('/').pop().split('?')[0];
          const extension = filename.split('.').pop().toLowerCase();
          
          console.log(`  File extension: ${extension}`);
          console.log(`  Filename length: ${filename.length} characters`);
          
          // Check for potential issues
          const issues = [];
          
          // 1. Check for HEIC format (might not display well in browsers)
          if (extension === 'heic') {
            issues.push('HEIC format - may not display correctly in some browsers');
          }
          
          // 2. Check for fleamarket placeholder patterns
          if (url.includes('fleamarket') && url.includes('Q90.jpg_')) {
            issues.push('Contains fleamarket placeholder pattern (_Q90.jpg_)');
          }
          
          // 3. Check for livephoto pattern
          if (url.includes('~livephoto~')) {
            issues.push('Contains livephoto pattern (~livephoto~)');
          }
          
          // 4. Check for very short filenames
          if (filename.length < 10) {
            issues.push('Very short filename - might be placeholder');
          }
          
          // 5. Check for common placeholder patterns
          const placeholderPatterns = [
            'placeholder', 'blank', 'white', '1x1', 'pixel', 'transparent',
            'noimage', 'default', 'missing', 'error'
          ];
          
          for (const pattern of placeholderPatterns) {
            if (url.toLowerCase().includes(pattern)) {
              issues.push(`Contains "${pattern}" pattern - might be placeholder`);
              break;
            }
          }
          
          // 6. Check for tiny image patterns
          if (url.includes('tps-48-48') || url.includes('tps-') && url.includes('-48')) {
            issues.push('Contains tiny placeholder pattern (tps-48-48)');
          }
          
          // 7. Check for dimension patterns
          const dimensionMatch = url.match(/(\d+)x(\d+)/);
          if (dimensionMatch) {
            const width = parseInt(dimensionMatch[1]);
            const height = parseInt(dimensionMatch[2]);
            console.log(`  Dimensions in URL: ${width}x${height}`);
            
            if (width < 100 || height < 100) {
              issues.push(`Small dimensions in URL (${width}x${height})`);
            }
          }
          
          // Display issues
          if (issues.length > 0) {
            console.log(`  ⚠️  Potential issues:`);
            issues.forEach(issue => console.log(`    • ${issue}`));
          } else {
            console.log(`  ✅ No obvious issues detected`);
          }
        }
      }
      
      console.log('\n' + '─'.repeat(60) + '\n');
    }
    
    // Technical analysis
    console.log('=== TECHNICAL ANALYSIS ===\n');
    
    console.log('Common reasons images might appear white/blank:');
    console.log('1. HEIC format - Not supported by all browsers');
    console.log('2. Broken image links - URL returns 404 or error');
    console.log('3. Placeholder images - Actual image is white/blank');
    console.log('4. CDN issues - Image hosting service problems');
    console.log('5. Large images - Taking too long to load');
    console.log('6. CORS issues - Cross-origin restrictions');
    console.log('7. Ad blockers - Blocking image domains');
    console.log('');
    
    console.log('Recommended checks:');
    console.log('1. Open image URLs directly in browser');
    console.log('2. Check network tab in browser DevTools');
    console.log('3. Test on different devices/browsers');
    console.log('4. Verify image URLs are accessible');
    console.log('5. Check for CORS headers on image server');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Analyze specific products
const productIdsToAnalyze = [228365, 114979];
analyzeProductImages(productIdsToAnalyze).catch(console.error);