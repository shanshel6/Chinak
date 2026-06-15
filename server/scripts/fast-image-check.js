#!/usr/bin/env node

/**
 * Fast Image Check Script
 * 
 * This script quickly checks product images and identifies broken ones.
 * It's optimized for speed and memory efficiency.
 */

import prisma from '../prismaClient.js';
import axios from 'axios';

// Configuration
const CONCURRENT_LIMIT = 20; // Max concurrent HTTP requests
const TIMEOUT = 5000; // 5 seconds timeout
const BATCH_SIZE = 500; // Products per batch

// Statistics
const stats = {
  startTime: Date.now(),
  totalProducts: 0,
  productsChecked: 0,
  productsWithImages: 0,
  productsWithoutImages: 0,
  totalImages: 0,
  brokenImages: 0,
  accessibleImages: 0,
  productsToDelete: 0,
  errors: 0
};

// Cache for image URLs (to avoid checking same URL multiple times)
const urlCache = new Map();

async function checkImageUrl(url) {
  // Check cache first
  if (urlCache.has(url)) {
    return urlCache.get(url);
  }
  
  try {
    // Use HEAD request for speed (no body download)
    const response = await axios.head(url, {
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      validateStatus: () => true // Don't throw on any status code
    });
    
    const result = {
      status: response.status,
      ok: response.status === 200,
      contentType: response.headers['content-type'] || 'unknown',
      size: response.headers['content-length'] || 'unknown'
    };
    
    urlCache.set(url, result);
    return result;
    
  } catch (error) {
    const result = {
      status: error.response?.status || 0,
      ok: false,
      error: error.message,
      contentType: 'unknown',
      size: 'unknown'
    };
    
    urlCache.set(url, result);
    return result;
  }
}

async function processBatch(offset, limit, dryRun = true) {
  // Fetch products in batch
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      status: 'PUBLISHED'
    },
    include: {
      images: {
        select: { url: true },
        orderBy: { order: 'asc' }
      }
    },
    skip: offset,
    take: limit,
    orderBy: { id: 'asc' }
  });
  
  const batchResults = [];
  
  // Process products in parallel (with concurrency limit)
  const chunks = [];
  for (let i = 0; i < products.length; i += CONCURRENT_LIMIT) {
    chunks.push(products.slice(i, i + CONCURRENT_LIMIT));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (product) => {
      stats.productsChecked++;
      
      if (product.images.length === 0) {
        stats.productsWithoutImages++;
        return {
          productId: product.id,
          name: product.name,
          totalImages: 0,
          brokenImages: 0,
          delete: true,
          reason: 'No images'
        };
      }
      
      stats.productsWithImages++;
      stats.totalImages += product.images.length;
      
      // Check all images for this product
      let brokenCount = 0;
      const imageChecks = [];
      
      for (const image of product.images) {
        const result = await checkImageUrl(image.url);
        
        imageChecks.push({
          url: image.url,
          status: result.status,
          ok: result.ok
        });
        
        if (result.ok) {
          stats.accessibleImages++;
        } else {
          stats.brokenImages++;
          brokenCount++;
        }
      }
      
      // If ALL images are broken, mark for deletion
      const shouldDelete = brokenCount === product.images.length && product.images.length > 0;
      
      if (shouldDelete) {
        stats.productsToDelete++;
      }
      
      return {
        productId: product.id,
        name: product.name,
        totalImages: product.images.length,
        brokenImages: brokenCount,
        delete: shouldDelete,
        reason: shouldDelete ? `All ${product.images.length} images broken` : 'Some images OK',
        imageChecks: imageChecks
      };
    });
    
    const chunkResults = await Promise.all(promises);
    batchResults.push(...chunkResults);
    
    // Show progress
    const percent = ((stats.productsChecked / stats.totalProducts) * 100).toFixed(1);
    console.log(`   Progress: ${stats.productsChecked}/${stats.totalProducts} (${percent}%)`);
  }
  
  return batchResults;
}

async function main() {
  console.log('🚀 Fast Image Check - Starting...\n');
  
  // Parse arguments
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--delete');
  const testMode = args.includes('--test');
  const batchSize = testMode ? 100 : BATCH_SIZE;
  
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'DELETE MODE'}`);
  console.log(`Batch size: ${batchSize}`);
  if (testMode) console.log(`Test mode: Checking first ${batchSize} products only`);
  console.log('');
  
  try {
    // Get total product count
    stats.totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`📊 Total active products: ${stats.totalProducts.toLocaleString()}`);
    console.log(`⏱️  Starting scan at: ${new Date().toLocaleTimeString()}`);
    console.log('');
    
    let offset = 0;
    let allResults = [];
    const productsToDelete = [];
    
    const maxProducts = testMode ? Math.min(batchSize, stats.totalProducts) : stats.totalProducts;
    
    while (offset < maxProducts) {
      const batchResults = await processBatch(offset, batchSize, dryRun);
      allResults.push(...batchResults);
      
      // Collect products to delete
      for (const result of batchResults) {
        if (result.delete) {
          productsToDelete.push(result);
        }
      }
      
      offset += batchSize;
      
      // Small delay to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Calculate time taken
    const timeTaken = Date.now() - stats.startTime;
    const minutes = Math.floor(timeTaken / 60000);
    const seconds = Math.floor((timeTaken % 60000) / 1000);
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 CHECK COMPLETE');
    console.log('='.repeat(60));
    console.log('');
    
    console.log(`⏱️  Time taken: ${minutes}m ${seconds}s`);
    console.log(`📦 Products checked: ${stats.productsChecked.toLocaleString()}`);
    console.log(`🖼️  Total images checked: ${stats.totalImages.toLocaleString()}`);
    console.log(`✅ Accessible images: ${stats.accessibleImages.toLocaleString()}`);
    console.log(`❌ Broken images: ${stats.brokenImages.toLocaleString()}`);
    console.log(`📊 Products with images: ${stats.productsWithImages.toLocaleString()}`);
    console.log(`🚫 Products without images: ${stats.productsWithoutImages.toLocaleString()}`);
    console.log(`🗑️  Products to delete: ${stats.productsToDelete.toLocaleString()}`);
    console.log(`⚠️  Errors: ${stats.errors}`);
    console.log('');
    
    // Broken image percentage
    if (stats.totalImages > 0) {
      const brokenPercent = ((stats.brokenImages / stats.totalImages) * 100).toFixed(2);
      console.log(`📈 Broken image rate: ${brokenPercent}%`);
    }
    
    // Show sample of broken products
    if (productsToDelete.length > 0) {
      console.log('\n📋 Sample of products with broken images:');
      const sampleSize = Math.min(5, productsToDelete.length);
      
      for (let i = 0; i < sampleSize; i++) {
        const p = productsToDelete[i];
        console.log(`\n${i + 1}. Product ${p.productId}: ${p.name.substring(0, 60)}...`);
        console.log(`   Reason: ${p.reason}`);
        console.log(`   Images: ${p.brokenImages}/${p.totalImages} broken`);
        
        if (p.imageChecks && p.imageChecks.length > 0) {
          console.log(`   Sample image status: ${p.imageChecks[0].status} ${p.imageChecks[0].ok ? '✅' : '❌'}`);
        }
      }
      
      if (productsToDelete.length > sampleSize) {
        console.log(`\n... and ${productsToDelete.length - sampleSize} more products.`);
      }
      
      // Estimated total broken products
      if (testMode && stats.productsToDelete > 0) {
        const estimatedTotal = Math.round((stats.productsToDelete / stats.productsChecked) * stats.totalProducts);
        console.log(`\n📈 Estimated total products with broken images: ${estimatedTotal.toLocaleString()}`);
        console.log(`   (Based on ${stats.productsToDelete} found in ${stats.productsChecked} sample)`);
      }
    } else {
      console.log('\n✅ No products found with all broken images!');
    }
    
    // Recommendations
    console.log('\n' + '='.repeat(60));
    console.log('💡 RECOMMENDATIONS');
    console.log('='.repeat(60));
    
    if (dryRun && productsToDelete.length > 0) {
      console.log('\nTo delete these products, run:');
      console.log('  node scripts/fast-image-check.js --delete');
      console.log('\nOr use the batch file:');
      console.log('  cleanup-broken-images.bat --delete');
    }
    
    if (stats.brokenImages > 0) {
      console.log('\nConsider:');
      console.log('1. Running full cleanup with --delete flag');
      console.log('2. Implementing image validation during import');
      console.log('3. Setting up periodic image health checks');
    }
    
    console.log('\n✅ Script completed at: ' + new Date().toLocaleTimeString());
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    stats.errors++;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;