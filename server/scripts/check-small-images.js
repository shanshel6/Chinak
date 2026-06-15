import prisma from '../prismaClient.js';

// Patterns for small/tiny/placeholder images
const SMALL_IMAGE_PATTERNS = [
  // Small dimensions in filename
  /(\d+)x(\d+)/,  // Looks for patterns like 48x48, 100x100, etc.
  
  // Tiny placeholder patterns
  /tps-48-48/,               // 48x48 tiny placeholder PNGs
  /tps-(\d+)-(\d+)/,         // Any tps-XXX-XXX pattern
  /thumb/,                   // Thumbnail images
  /small/,                   // Small images
  /mini/,                    // Mini images
  /tiny/,                    // Tiny images
  
  // Placeholder/blank images
  /placeholder/i,
  /blank/i,
  /white\.(jpg|png|gif|webp)$/i,
  /1x1\.(jpg|png|gif|webp)$/i,
  /pixel\.(jpg|png|gif|webp)$/i,
  /transparent\.(jpg|png|gif|webp)$/i,
  /no[-_]?image/i,
  /default[-_]?image/i,
  /missing[-_]?image/i,
  /error[-_]?image/i,
  
  // Fleamarket/white images
  /_Q90\.jpg_$/,
  /~livephoto~/,
];

// Check if image URL suggests a small/tiny image
function isSmallImageByUrl(url) {
  if (!url || url.trim() === '') return true;
  
  // Check all patterns
  for (const pattern of SMALL_IMAGE_PATTERNS) {
    if (pattern.test(url)) {
      // For dimension patterns (like 48x48), check if dimensions are small
      if (pattern.toString().includes('(\\d+)x(\\d+)')) {
        const match = url.match(pattern);
        if (match) {
          const width = parseInt(match[1]);
          const height = parseInt(match[2]);
          // Consider images smaller than 100x100 as "small"
          if (width < 100 && height < 100) {
            return true;
          }
        }
      } else {
        return true;
      }
    }
  }
  
  // Check for very short filenames (likely placeholder)
  const filename = url.split('/').pop().split('?')[0];
  if (filename.length < 5 && /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
    return true;
  }
  
  return false;
}

async function checkProductsForSmallImages(sampleSize = 1000) {
  console.log(`🔍 Checking ${sampleSize.toLocaleString()} products for small/tiny images...\n`);
  
  try {
    // Get total count
    const totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`Total active products in database: ${totalProducts.toLocaleString()}`);
    console.log(`Checking sample of: ${sampleSize.toLocaleString()} products\n`);
    
    // Get sample of products
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      },
      include: {
        images: {
          select: { id: true, url: true },
          orderBy: { order: 'asc' }
        }
      },
      take: sampleSize,
      orderBy: { id: 'asc' }
    });
    
    console.log(`Fetched ${products.length} products for analysis.\n`);
    
    // Analyze products
    let singleImageCount = 0;
    let smallImageCount = 0;
    let productsWithSmallImages = [];
    
    for (const product of products) {
      const imageCount = product.images.length;
      
      if (imageCount === 1) {
        singleImageCount++;
        const imageUrl = product.images[0].url;
        const isSmall = isSmallImageByUrl(imageUrl);
        
        if (isSmall) {
          smallImageCount++;
          productsWithSmallImages.push({
            id: product.id,
            name: product.name,
            imageUrl: imageUrl,
            imageCount: imageCount
          });
        }
      }
    }
    
    // Calculate percentages
    const singleImagePercent = ((singleImageCount / products.length) * 100).toFixed(1);
    const smallImagePercent = ((smallImageCount / products.length) * 100).toFixed(1);
    
    console.log('\n=== ANALYSIS RESULTS ===\n');
    console.log(`Products analyzed: ${products.length.toLocaleString()}`);
    console.log(`Products with single image: ${singleImageCount.toLocaleString()} (${singleImagePercent}%)`);
    console.log(`Products with single small/tiny image: ${smallImageCount.toLocaleString()} (${smallImagePercent}%)`);
    
    if (productsWithSmallImages.length > 0) {
      console.log('\n=== PRODUCTS WITH SINGLE SMALL/TINY IMAGES ===\n');
      
      // Show first 10 products
      const displayCount = Math.min(10, productsWithSmallImages.length);
      for (let i = 0; i < displayCount; i++) {
        const p = productsWithSmallImages[i];
        console.log(`${i + 1}. Product ${p.id}: ${p.name.substring(0, 60)}...`);
        console.log(`   Image URL: ${p.imageUrl}`);
        console.log(`   Image count: ${p.imageCount}`);
        console.log('');
      }
      
      if (productsWithSmallImages.length > displayCount) {
        console.log(`... and ${productsWithSmallImages.length - displayCount} more products with single small images.`);
      }
      
      console.log('\n=== ESTIMATED TOTAL IN DATABASE ===');
      const estimatedTotal = Math.round((smallImageCount / products.length) * totalProducts);
      console.log(`Estimated total products with single small images: ${estimatedTotal.toLocaleString()}`);
      console.log(`(Based on ${smallImageCount} found in ${products.length} sample)`);
      
    } else {
      console.log('\n✅ No products found with single small/tiny images in this sample.');
    }
    
    // Additional analysis: check all images (not just single-image products)
    console.log('\n=== ADDITIONAL ANALYSIS: ALL IMAGES ===\n');
    
    let totalImages = 0;
    let totalSmallImages = 0;
    
    for (const product of products) {
      totalImages += product.images.length;
      
      for (const image of product.images) {
        if (isSmallImageByUrl(image.url)) {
          totalSmallImages++;
        }
      }
    }
    
    const smallImageOverallPercent = ((totalSmallImages / totalImages) * 100).toFixed(1);
    
    console.log(`Total images in sample: ${totalImages.toLocaleString()}`);
    console.log(`Small/tiny images found: ${totalSmallImages.toLocaleString()} (${smallImageOverallPercent}%)`);
    console.log(`Average images per product: ${(totalImages / products.length).toFixed(1)}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the analysis
async function main() {
  console.log('=== Small/Tiny Image Detection Script ===\n');
  
  // Check 1000 products
  await checkProductsForSmallImages(1000);
  
  console.log('\n=== SCRIPT COMPLETE ===');
}

// Execute
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;