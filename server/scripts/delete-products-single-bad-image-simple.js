import prisma from '../prismaClient.js';

/**
 * Simple script to delete products that have only one photo and that photo matches bad patterns.
 * This version only checks URL patterns without downloading images.
 * 
 * Logic:
 * 1. Find products with exactly one ProductImage
 * 2. Check if that single image URL matches bad patterns
 * 3. Delete the product if the image URL is bad
 */

// Bad image patterns from URL
const BAD_IMAGE_URL_PATTERNS = [
  /_Q90\.jpg_$/,             // fleamarket white/placeholder images
  /~livephoto~/,             // live photo HEIC variants
  /tps-48-48/,               // 48x48 tiny placeholder PNGs
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
  /\.(gif|png|jpg|jpeg|webp)$/i, // Check for very short filenames (like "a.jpg")
  (url) => {
    // Check for very short filenames (likely placeholder)
    const filename = url.split('/').pop().split('?')[0];
    return filename.length < 5 && /\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
  }
];

function isBadImageByUrl(url) {
  if (!url || url.trim() === '') return true;
  
  // Check all patterns
  for (const pattern of BAD_IMAGE_URL_PATTERNS) {
    if (typeof pattern === 'function') {
      if (pattern(url)) return true;
    } else if (pattern.test(url)) {
      return true;
    }
  }
  
  return false;
}

async function findProductsWithSingleBadImage(batchSize = 100) {
  console.log('Finding products with single bad image...');
  
  let offset = 0;
  const productsToDelete = [];
  
  while (true) {
    // Find products with exactly one ProductImage
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
      skip: offset,
      take: batchSize,
      orderBy: { id: 'asc' }
    });
    
    if (products.length === 0) break;
    
    console.log(`  Processing batch ${offset} to ${offset + products.length}...`);
    
    for (const product of products) {
      // Skip products with no images or more than one image
      if (product.images.length !== 1) {
        continue;
      }
      
      const singleImage = product.images[0];
      
      // Check if the image URL is bad
      if (isBadImageByUrl(singleImage.url)) {
        productsToDelete.push({
          id: product.id,
          name: product.name,
          imageUrl: singleImage.url,
          imageCount: product.images.length
        });
      }
    }
    
    offset += batchSize;
    
    // Small delay to avoid overwhelming the database
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return productsToDelete;
}

async function deleteProducts(products, dryRun = true) {
  if (products.length === 0) {
    console.log('No products to delete.');
    return;
  }
  
  console.log(`\n${dryRun ? 'Would delete' : 'Deleting'} ${products.length} products...\n`);
  
  let deletedCount = 0;
  let errorCount = 0;
  
  for (const product of products) {
    try {
      console.log(`Product ${product.id}: ${product.name.substring(0, 60)}...`);
      console.log(`  Image: ${product.imageUrl}`);
      console.log(`  Images: ${product.imageCount}`);
      
      if (!dryRun) {
        // Delete the product (cascade will delete images, variants, etc.)
        await prisma.product.delete({
          where: { id: product.id }
        });
        
        console.log(`  ✓ Deleted`);
        deletedCount++;
      } else {
        console.log(`  ✓ Would delete (dry run)`);
      }
      
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      errorCount++;
    }
    
    console.log('');
  }
  
  return { deletedCount, errorCount };
}

async function main() {
  console.log('=== Product Cleanup: Delete products with single bad image (Simple Version) ===\n');
  console.log('This script will:');
  console.log('1. Find products with exactly one ProductImage');
  console.log('2. Check if that single image URL matches bad patterns');
  console.log('3. Delete products where the image URL indicates a bad image\n');
  
  try {
    // Get total count of active products
    const totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`Total active products in database: ${totalProducts}\n`);
    
    // First, do a dry run to see what would be deleted
    console.log('=== DRY RUN ===');
    const productsToDelete = await findProductsWithSingleBadImage();
    
    console.log(`\nFound ${productsToDelete.length} products with single bad image.`);
    
    if (productsToDelete.length > 0) {
      const result = await deleteProducts(productsToDelete, true);
      
      console.log('\n=== SUMMARY (Dry Run) ===');
      console.log(`Products analyzed: ${totalProducts}`);
      console.log(`Products with single bad image: ${productsToDelete.length}`);
      console.log(`Products that would be deleted: ${productsToDelete.length}`);
      
      // Ask if user wants to proceed with actual deletion
      console.log('\n⚠️  WARNING: Actual deletion will permanently remove these products.');
      console.log('To proceed with actual deletion, run:');
      console.log('   node scripts/delete-products-single-bad-image-simple.js --delete');
      console.log('\nOr set dryRun = false in the code and run again.');
      
    } else {
      console.log('\n✅ No products found with single bad images.');
    }
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Check for --delete flag
const shouldDelete = process.argv.includes('--delete');

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  if (shouldDelete) {
    console.log('⚠️  WARNING: Running in DELETE mode. Products will be permanently deleted.');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Run actual deletion
    (async () => {
      try {
        const productsToDelete = await findProductsWithSingleBadImage();
        console.log(`\nFound ${productsToDelete.length} products to delete.`);
        
        if (productsToDelete.length > 0) {
          const result = await deleteProducts(productsToDelete, false);
          console.log(`\n✅ Deleted ${result.deletedCount} products successfully.`);
          if (result.errorCount > 0) {
            console.log(`⚠️  Had ${result.errorCount} errors during deletion.`);
          }
        } else {
          console.log('\n✅ No products to delete.');
        }
      } catch (error) {
        console.error('\n❌ Script failed:', error);
      } finally {
        await prisma.$disconnect();
      }
    })();
  } else {
    main().catch(console.error);
  }
}

export default main;