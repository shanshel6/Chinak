#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Configuration
const CONCURRENT_LIMIT = 30;
const TIMEOUT = 5000;
const BATCH_SIZE = 500;
const RESULTS_FILE = path.join(__dirname, 'scan-results.json');

// Load existing results from file if they exist
let savedStats = {
  totalProducts: null, // Set to null initially
  productsChecked: 0,
  productsWithoutImages: [],
  productsWithAllBrokenImages: [],
  productsWithSomeBrokenImages: [],
  totalImages: 0,
  brokenImages: 0,
  accessibleImages: 0,
  lastOffset: 0
};
if (fs.existsSync(RESULTS_FILE)) {
  try {
    savedStats = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    console.log('📂 Loaded existing results - last checked up to product ' + savedStats.lastOffset + '\n');
  } catch (e) {
    console.log('⚠️ Could not load existing results, starting fresh\n');
  }
}

let stats = savedStats;

// Cache for image URLs
const urlCache = new Map();

// Setup readline
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

// Save results to disk
const saveResults = () => {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(stats, null, 2));
};

async function checkImageUrl(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  try {
    const response = await axios.head(url, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: () => true
    });
    const result = { ok: response.status >= 200 && response.status < 400 };
    urlCache.set(url, result);
    return result;
  } catch (error) {
    const result = { ok: false };
    urlCache.set(url, result);
    return result;
  }
}

async function processProduct(product) {
  stats.productsChecked++;
  
  if (product.images.length === 0) {
    stats.productsWithoutImages.push({
      productId: product.id, name: product.name, totalImages: 0, reason: 'No images'
    });
    return;
  }
  
  stats.totalImages += product.images.length;
  let brokenCount = 0;
  let brokenImageIds = [];
  let brokenImageUrls = [];
  let goodImageUrls = [];
  
  for (const image of product.images) {
    const result = await checkImageUrl(image.url);
    if (result.ok) {
      stats.accessibleImages++;
      goodImageUrls.push({ id: image.id, url: image.url });
    } else {
      stats.brokenImages++;
      brokenCount++;
      brokenImageIds.push(image.id);
      brokenImageUrls.push(image.url);
    }
  }
  
  if (brokenCount === product.images.length) {
    stats.productsWithAllBrokenImages.push({
      productId: product.id, name: product.name, totalImages: product.images.length, brokenImages: brokenCount, brokenImageIds, mainImage: product.image, reason: `All ${product.images.length} images broken`
    });
  } else if (brokenCount > 0) {
    stats.productsWithSomeBrokenImages.push({
      productId: product.id, name: product.name, totalImages: product.images.length, brokenImages: brokenCount, brokenImageIds, brokenImageUrls, goodImageUrls, mainImage: product.image, reason: `${brokenCount}/${product.images.length} images broken`
    });
  }
}

async function scanProducts() {
  console.log('🚀 Starting scan (will save to disk every 500 products)\n');
  
  try {
    stats.totalProducts = await prisma.product.count();
    let offset = stats.lastOffset;
    let lastProgressUpdate = 0;
    let batchCount = Math.floor(offset / BATCH_SIZE);
    
    while (offset < stats.totalProducts) {
      batchCount++;
      console.log(`📦 Fetching batch ${batchCount} (products ${offset + 1} - ${Math.min(offset + BATCH_SIZE, stats.totalProducts)})...`);
      
      let products;
      try {
        products = await prisma.product.findMany({
          include: { images: true },
          skip: offset,
          take: BATCH_SIZE,
          orderBy: { id: 'asc' }
        });
      } catch (dbError) {
        console.error('❌ Database error, waiting 10 seconds and retrying...');
        await new Promise(r => setTimeout(r, 10000));
        continue; // retry the same batch
      }
      
      if (products.length === 0) break;
      
      console.log(`   Processing ${products.length} products with ${CONCURRENT_LIMIT} concurrent workers...`);
      
      const chunks = [];
      for (let i = 0; i < products.length; i += CONCURRENT_LIMIT) {
        chunks.push(products.slice(i, i + CONCURRENT_LIMIT));
      }
      
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async (product) => {
          await processProduct(product);
          
          if (stats.productsChecked - lastProgressUpdate >= 50) {
            lastProgressUpdate = stats.productsChecked;
            const percent = ((stats.productsChecked / stats.totalProducts) * 100);
            process.stdout.write(`   Progress: ${stats.productsChecked.toLocaleString()}/${stats.totalProducts.toLocaleString()} (${percent.toFixed(1)}%) | Images: ${stats.accessibleImages.toLocaleString()} ok, ${stats.brokenImages.toLocaleString()} broken\r`);
          }
        }));
      }
      
      offset += BATCH_SIZE;
      stats.lastOffset = offset;
      saveResults();
      console.log(`✅ Batch ${batchCount} complete (saved to disk)\n`);
    }
    
    const percent = ((stats.productsChecked / stats.totalProducts) * 100);
    console.log(`\n✅ Scan 100% complete! Final Progress: ${stats.productsChecked.toLocaleString()}/${stats.totalProducts.toLocaleString()} (${percent.toFixed(1)}%)\n`);
    return true;
  } catch (error) {
    console.error('\n❌ Scan error:', error);
    saveResults();
    return false;
  }
}

function printSummary() {
  console.log('='.repeat(80));
  console.log('📊 SCAN SUMMARY');
  console.log('='.repeat(80));
  console.log('\nProducts checked: ' + stats.productsChecked.toLocaleString());
  console.log('Images checked: ' + stats.totalImages.toLocaleString());
  console.log('Accessible images: ' + stats.accessibleImages.toLocaleString());
  console.log('Broken images: ' + stats.brokenImages.toLocaleString());
  console.log('\n🚫 Products without images: ' + stats.productsWithoutImages.length.toLocaleString());
  console.log('🔥 Products with ALL images broken: ' + stats.productsWithAllBrokenImages.length.toLocaleString());
  console.log('⚠️ Products with SOME images broken: ' + stats.productsWithSomeBrokenImages.length.toLocaleString());
  console.log('='.repeat(80));
  
  if (stats.productsWithAllBrokenImages.length > 0) {
    console.log('\nSample products with ALL images broken:');
    stats.productsWithAllBrokenImages.slice(0, 5).forEach(p => {
      console.log('  - Product ' + p.productId + ' (' + p.name.substring(0, 50) + '...) - ' + p.totalImages + ' broken images');
    });
  }
  if (stats.productsWithSomeBrokenImages.length > 0) {
    console.log('\nSample products with SOME images broken:');
    stats.productsWithSomeBrokenImages.slice(0, 5).forEach(p => {
      console.log('  - Product ' + p.productId + ' (' + p.name.substring(0, 50) + '...) - ' + p.brokenImages + '/' + p.totalImages + ' broken');
    });
  }
}

async function performCleanup() {
  const answer = await askQuestion('\nPress ENTER to proceed with cleanup, or type "n" to cancel: ');
  
  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    console.log('✅ Cleanup cancelled');
    return;
  }
  
  console.log('\n🚀 Starting cleanup...');
  
  if (stats.productsWithoutImages.length > 0) {
    console.log('\nHandling ' + stats.productsWithoutImages.length + ' products without images...');
    let deletedCount = 0;
    let deactivatedCount = 0;
    for (const p of stats.productsWithoutImages) {
      try {
        await prisma.product.delete({ where: { id: p.productId } });
        deletedCount++;
      } catch (e) {
        await prisma.product.update({ where: { id: p.productId }, data: { isActive: false, status: 'DRAFT' } });
        deactivatedCount++;
      }
      if ((deletedCount + deactivatedCount) % 50 === 0) {
        console.log('  ... processed ' + (deletedCount + deactivatedCount) + '/' + stats.productsWithoutImages.length);
      }
    }
    console.log('  ✅ Done: Deleted ' + deletedCount + ', Deactivated ' + deactivatedCount);
  }
  
  if (stats.productsWithAllBrokenImages.length > 0) {
    console.log('\nHandling ' + stats.productsWithAllBrokenImages.length + ' products with ALL images broken...');
    let deletedCount = 0;
    let deactivatedCount = 0;
    for (const p of stats.productsWithAllBrokenImages) {
      try {
        await prisma.product.delete({ where: { id: p.productId } });
        deletedCount++;
      } catch (e) {
        await prisma.product.update({ where: { id: p.productId }, data: { isActive: false, status: 'DRAFT', image: null } });
        await prisma.productImage.deleteMany({ where: { productId: p.productId } });
        deactivatedCount++;
      }
      if ((deletedCount + deactivatedCount) % 50 === 0) {
        console.log('  ... processed ' + (deletedCount + deactivatedCount) + '/' + stats.productsWithAllBrokenImages.length);
      }
    }
    console.log('  ✅ Done: Deleted ' + deletedCount + ', Deactivated ' + deactivatedCount);
  }
  
  if (stats.productsWithSomeBrokenImages.length > 0) {
    console.log('\nHandling ' + stats.productsWithSomeBrokenImages.length + ' products with SOME images broken...');
    let imagesDeleted = 0;
    let mainImagesUpdated = 0;
    for (const p of stats.productsWithSomeBrokenImages) {
      await prisma.productImage.deleteMany({ where: { id: { in: p.brokenImageIds } } });
      imagesDeleted += p.brokenImageIds.length;
      
      if (p.mainImage && p.brokenImageUrls.includes(p.mainImage) && p.goodImageUrls.length > 0) {
        await prisma.product.update({ where: { id: p.productId }, data: { image: p.goodImageUrls[0].url } });
        mainImagesUpdated++;
      }
      if (imagesDeleted % 500 === 0) {
        console.log('  ... deleted ' + imagesDeleted + ' broken images so far');
      }
    }
    console.log('  ✅ Done: Deleted ' + imagesDeleted + ' broken images, Updated ' + mainImagesUpdated + ' main images');
  }
  
  console.log('\n✅ Cleanup complete!');
}

async function main() {
  // Get total products count from DB first
  if (stats.totalProducts === null) {
    stats.totalProducts = await prisma.product.count();
  }
  
  if (stats.productsChecked < stats.totalProducts) {
    const scanAnswer = await askQuestion('We have partial/no scan results. Scan products? (y/n): ');
    if (scanAnswer.toLowerCase() === 'y' || scanAnswer.toLowerCase() === '') {
      await scanProducts();
    } else {
      console.log('Okay, using existing partial scan results...');
    }
  } else {
    console.log('✅ Full scan already complete!');
  }
  
  printSummary();
  
  await performCleanup();
  
  rl.close();
  await prisma.$disconnect();
}

main().catch(console.error);
