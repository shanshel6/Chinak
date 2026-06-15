#!/usr/bin/env node

/**
 * Script to delete products with broken images (404 Not Found)
 * 
 * Logic:
 * 1. Check all product images
 * 2. If an image returns 404, mark it as broken
 * 3. If ALL images for a product are broken, delete the product
 * 4. If SOME images are broken but others are OK, keep the product (just bad images)
 */

import prisma from '../prismaClient.js';
import axios from 'axios';

// Configuration
const BATCH_SIZE = 100;
const MAX_CONCURRENT_REQUESTS = 10;
const REQUEST_TIMEOUT = 10000; // 10 seconds
const RETRY_ATTEMPTS = 2;

// Statistics
let stats = {
  totalProducts: 0,
  productsChecked: 0,
  productsWithBrokenImages: 0,
  productsDeleted: 0,
  imagesChecked: 0,
  brokenImages: 0,
  errors: 0
};

// Cache for image URLs we've already checked
const imageCache = new Map();

async function testImageUrl(url) {
  // Check cache first
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }
  
  let attempts = 0;
  
  while (attempts < RETRY_ATTEMPTS) {
    try {
      const response = await axios.head(url, {
        timeout: REQUEST_TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/*'
        },
        validateStatus: (status) => status < 500 // Don't throw for 404, 403, etc.
      });
      
      const result = {
        status: response.status,
        ok: response.status === 200,
        contentType: response.headers['content-type'] || 'unknown',
        contentLength: response.headers['content-length'] || 'unknown'
      };
      
      // Cache the result
      imageCache.set(url, result);
      return result;
      
    } catch (error) {
      attempts++;
      
      if (attempts === RETRY_ATTEMPTS) {
        // Final attempt failed
        const result = {
          status: error.response?.status || 0,
          ok: false,
          error: error.message,
          contentType: 'unknown',
          contentLength: 'unknown'
        };
        
        imageCache.set(url, result);
        return result;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function processProductsBatch(offset, limit, dryRun = true) {
  console.log(`\n📦 Processing batch ${offset + 1} to ${offset + limit}...`);
  
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      status: 'PUBLISHED'
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
    },
    skip: offset,
    take: limit,
    orderBy: { id: 'asc' }
  });
  
  console.log(`   Found ${products.length} products in this batch`);
  
  const productsToDelete = [];
  
  for (const product of products) {
    stats.productsChecked++;
    
    if (product.images.length === 0) {
      // Product has no images at all
      console.log(`   Product ${product.id}: No images found`);
      productsToDelete.push({
        id: product.id,
        name: product.name,
        reason: 'No images',
        brokenImages: 0,
        totalImages: 0
      });
      continue;
    }
    
    // Test each image
    let brokenImageCount = 0;
    const imageResults = [];
    
    for (const image of product.images) {
      stats.imagesChecked++;
      
      console.log(`   Testing image ${image.id} for product ${product.id}...`);
      const result = await testImageUrl(image.url);
      
      imageResults.push({
        id: image.id,
        url: image.url,
        status: result.status,
        ok: result.ok
      });
      
      if (!result.ok) {
        brokenImageCount++;
        stats.brokenImages++;
      }
    }
    
    // If ALL images are broken, mark for deletion
    if (brokenImageCount === product.images.length && product.images.length > 0) {
      console.log(`   Product ${product.id}: ALL images broken (${brokenImageCount}/${product.images.length})`);
      productsToDelete.push({
        id: product.id,
        name: product.name,
        reason: `All images broken (${brokenImageCount} images)`,
        brokenImages: brokenImageCount,
        totalImages: product.images.length,
        imageResults: imageResults
      });
      stats.productsWithBrokenImages++;
    } else if (brokenImageCount > 0) {
      // Some images broken, but not all
      console.log(`   Product ${product.id}: ${brokenImageCount} broken images (keeping product)`);
      stats.productsWithBrokenImages++;
    }
    
    // Update progress
    if (stats.productsChecked % 10 === 0) {
      const percent = ((stats.productsChecked / stats.totalProducts) * 100).toFixed(1);
      console.log(`   Progress: ${stats.productsChecked}/${stats.totalProducts} (${percent}%)`);
    }
  }
  
  // Delete products if not dry run
  if (!dryRun && productsToDelete.length > 0) {
    console.log(`\n🗑️  Deleting ${productsToDelete.length} products...`);
    
    for (const product of productsToDelete) {
      try {
        console.log(`   Deleting product ${product.id}: ${product.name.substring(0, 50)}...`);
        
        await prisma.product.delete({
          where: { id: product.id }
        });
        
        stats.productsDeleted++;
        console.log(`   ✅ Deleted successfully`);
        
      } catch (error) {
        console.error(`   ❌ Failed to delete product ${product.id}:`, error.message);
        stats.errors++;
      }
    }
  }
  
  return productsToDelete;
}

async function main() {
  console.log('=== Delete Products with Broken Images ===\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--delete');
  const batchSize = parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1]) || BATCH_SIZE;
  
  console.log(`Mode: ${dryRun ? 'DRY RUN (no deletion)' : 'DELETE MODE'}`);
  console.log(`Batch size: ${batchSize}`);
  console.log('');
  
  try {
    // Get total count
    stats.totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`Total active products: ${stats.totalProducts.toLocaleString()}`);
    console.log(`Starting scan...\n`);
    
    let offset = 0;
    let allProductsToDelete = [];
    
    while (offset < stats.totalProducts) {
      const productsToDelete = await processProductsBatch(offset, batchSize, dryRun);
      allProductsToDelete.push(...productsToDelete);
      
      offset += batchSize;
      
      // Small delay to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log('');
    
    console.log(`Products checked: ${stats.productsChecked.toLocaleString()}`);
    console.log(`Images checked: ${stats.imagesChecked.toLocaleString()}`);
    console.log(`Broken images found: ${stats.brokenImages.toLocaleString()}`);
    console.log(`Products with broken images: ${stats.productsWithBrokenImages.toLocaleString()}`);
    console.log(`Products to delete: ${allProductsToDelete.length.toLocaleString()}`);
    
    if (dryRun) {
      console.log(`Products actually deleted: 0 (dry run)`);
    } else {
      console.log(`Products actually deleted: ${stats.productsDeleted.toLocaleString()}`);
    }
    
    console.log(`Errors: ${stats.errors}`);
    
    // Show sample of products to delete
    if (allProductsToDelete.length > 0) {
      console.log('\n📋 Sample of products to delete:');
      const sampleSize = Math.min(5, allProductsToDelete.length);
      
      for (let i = 0; i < sampleSize; i++) {
        const p = allProductsToDelete[i];
        console.log(`\n${i + 1}. Product ${p.id}: ${p.name.substring(0, 60)}...`);
        console.log(`   Reason: ${p.reason}`);
        
        if (p.imageResults && p.imageResults.length > 0) {
          console.log(`   Image status:`);
          p.imageResults.forEach(img => {
            console.log(`     - Image ${img.id}: ${img.status} ${img.ok ? '✅' : '❌'}`);
          });
        }
      }
      
      if (allProductsToDelete.length > sampleSize) {
        console.log(`\n... and ${allProductsToDelete.length - sampleSize} more products.`);
      }
    }
    
    // Recommendations
    console.log('\n' + '='.repeat(60));
    console.log('💡 RECOMMENDATIONS');
    console.log('='.repeat(60));
    
    if (dryRun && allProductsToDelete.length > 0) {
      console.log('\nTo delete these products, run:');
      console.log('  node scripts/delete-broken-image-products.js --delete');
      console.log('\nOr use the batch file:');
      console.log('  cleanup-broken-images.bat --delete');
    }
    
    if (stats.brokenImages > 0) {
      console.log('\nConsider implementing:');
      console.log('1. Image validation during product import');
      console.log('2. Periodic image health checks');
      console.log('3. Fallback images for broken links');
      console.log('4. CDN monitoring for image hosting');
    }
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    stats.errors++;
  } finally {
    await prisma.$disconnect();
    
    // Save stats to file
    const fs = await import('fs');
    const statsFile = `broken-images-stats-${Date.now()}.json`;
    fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    console.log(`\n📊 Statistics saved to: ${statsFile}`);
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;