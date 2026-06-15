#!/usr/bin/env node

/**
 * Cleanup Bad Products Script
 * 
 * This script finds and deletes products that have only one photo
 * and that photo is a small dot or white/blank image.
 * 
 * Usage:
 *   node cleanup-bad-products.js           # Dry run (default)
 *   node cleanup-bad-products.js --delete  # Actually delete products
 *   node cleanup-bad-products.js --help    # Show help
 * 
 * The script checks for bad image URLs using patterns like:
 * - _Q90.jpg_ (fleamarket placeholder/white images)
 * - ~livephoto~ (live photo HEIC variants)
 * - tps-48-48 (48x48 tiny placeholder PNGs)
 * - placeholder, blank, white, 1x1, pixel, transparent
 * - Very short filenames (like "a.jpg")
 */

import prisma from '../prismaClient.js';

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
];

function isBadImageByUrl(url) {
  if (!url || url.trim() === '') return true;
  
  // Check all patterns
  for (const pattern of BAD_IMAGE_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  
  // Check for very short filenames (likely placeholder)
  const filename = url.split('/').pop().split('?')[0];
  if (filename.length < 5 && /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
    return true;
  }
  
  return false;
}

async function findProductsWithSingleBadImage(batchSize = 200) {
  console.log('🔍 Finding products with single bad image...');
  
  let offset = 0;
  const productsToDelete = [];
  let totalProcessed = 0;
  
  // First get total count
  const totalProducts = await prisma.product.count({
    where: {
      isActive: true,
      status: 'PUBLISHED'
    }
  });
  
  console.log(`   Total active products: ${totalProducts.toLocaleString()}`);
  
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
    
    totalProcessed += products.length;
    
    // Show progress every 1000 products
    if (totalProcessed % 1000 === 0 || totalProcessed === totalProducts) {
      console.log(`   Processed: ${totalProcessed.toLocaleString()}/${totalProducts.toLocaleString()} (${Math.round((totalProcessed / totalProducts) * 100)}%)`);
    }
    
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
  
  return { productsToDelete, totalProcessed, totalProducts };
}

async function deleteProducts(products, dryRun = true) {
  if (products.length === 0) {
    console.log('✅ No products to delete.');
    return { deletedCount: 0, errorCount: 0 };
  }
  
  console.log(`\n${dryRun ? '📋 Would delete' : '🗑️  Deleting'} ${products.length} products...\n`);
  
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
        
        console.log(`  ✅ Deleted`);
        deletedCount++;
      } else {
        console.log(`  ⚠️  Would delete (dry run)`);
      }
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errorCount++;
    }
    
    console.log('');
  }
  
  return { deletedCount, errorCount };
}

function showHelp() {
  console.log(`
Cleanup Bad Products Script
===========================

This script finds and deletes products that have only one photo
and that photo is a small dot or white/blank image.

Usage:
  node cleanup-bad-products.js           # Dry run (default)
  node cleanup-bad-products.js --delete  # Actually delete products
  node cleanup-bad-products.js --help    # Show this help

What it does:
1. Scans all active, published products
2. Finds products with exactly one ProductImage
3. Checks if that single image URL matches bad patterns
4. Deletes the product if the image URL indicates a bad image

Bad image patterns include:
  - _Q90.jpg_ (fleamarket placeholder/white images)
  - ~livephoto~ (live photo HEIC variants)
  - tps-48-48 (48x48 tiny placeholder PNGs)
  - placeholder, blank, white, 1x1, pixel, transparent
  - Very short filenames (like "a.jpg")

Safety features:
  - Default is dry run mode (no deletion)
  - Requires --delete flag for actual deletion
  - Shows exactly what would be deleted first
  - Processes in batches to avoid memory issues
`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes('--delete');
  const showHelpFlag = args.includes('--help') || args.includes('-h');
  
  if (showHelpFlag) {
    showHelp();
    process.exit(0);
  }
  
  console.log('=== Product Cleanup: Delete products with single bad image ===\n');
  
  if (shouldDelete) {
    console.log('⚠️  WARNING: Running in DELETE mode. Products will be permanently deleted.');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    console.log('Running in DRY RUN mode (no products will be deleted).');
    console.log('Use --delete flag to actually delete products.\n');
  }
  
  try {
    // Find products with single bad images
    const { productsToDelete, totalProcessed, totalProducts } = await findProductsWithSingleBadImage();
    
    console.log('\n=== SCAN COMPLETE ===');
    console.log(`Products analyzed: ${totalProcessed.toLocaleString()}`);
    console.log(`Products with single bad image: ${productsToDelete.length.toLocaleString()}`);
    
    if (productsToDelete.length === 0) {
      console.log('\n✅ No products found with single bad images.');
      return;
    }
    
    // Show sample of what would be deleted
    console.log('\nSample of products found:');
    const sampleSize = Math.min(5, productsToDelete.length);
    for (let i = 0; i < sampleSize; i++) {
      const p = productsToDelete[i];
      console.log(`${i + 1}. Product ${p.id}: ${p.name.substring(0, 50)}...`);
      console.log(`   Image: ${p.imageUrl}`);
    }
    
    if (productsToDelete.length > sampleSize) {
      console.log(`   ... and ${productsToDelete.length - sampleSize} more`);
    }
    
    // Delete or dry run
    const result = await deleteProducts(productsToDelete, !shouldDelete);
    
    console.log('\n=== FINAL SUMMARY ===');
    console.log(`Total products in database: ${totalProducts.toLocaleString()}`);
    console.log(`Products analyzed: ${totalProcessed.toLocaleString()}`);
    console.log(`Products with single bad image: ${productsToDelete.length.toLocaleString()}`);
    
    if (shouldDelete) {
      console.log(`Products actually deleted: ${result.deletedCount.toLocaleString()}`);
      if (result.errorCount > 0) {
        console.log(`Errors during deletion: ${result.errorCount}`);
      }
      console.log('\n✅ Cleanup completed successfully!');
    } else {
      console.log('\n⚠️  Dry run completed. No products were deleted.');
      console.log('To actually delete these products, run:');
      console.log('   node cleanup-bad-products.js --delete');
    }
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;