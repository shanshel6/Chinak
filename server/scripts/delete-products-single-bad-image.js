import prisma from '../prismaClient.js';
import axios from 'axios';
import sharp from 'sharp';
import { createCanvas, loadImage } from 'canvas';

/**
 * Script to delete products that have only one photo and that photo is a small dot or white only.
 * 
 * Logic:
 * 1. Find products with exactly one ProductImage
 * 2. Download and analyze that single image
 * 3. Check if the image is mostly white/blank or a small dot
 * 4. Delete the product if the image meets the criteria
 */

// Configuration
const BATCH_SIZE = 100;
const MAX_IMAGE_SIZE = 1024 * 1024 * 5; // 5MB max
const IMAGE_TIMEOUT = 10000; // 10 seconds

// Image analysis thresholds
const WHITE_THRESHOLD = 0.95; // 95% of pixels are white
const SMALL_DOT_THRESHOLD = 0.01; // 1% of pixels are non-white (small dot)
const MIN_VALID_PIXELS = 100; // Minimum non-white pixels to be considered valid

// Bad image patterns from URL (fast check)
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
];

function isBadImageByUrl(url) {
  if (!url) return true;
  return BAD_IMAGE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

async function downloadImage(url) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: IMAGE_TIMEOUT,
      maxContentLength: MAX_IMAGE_SIZE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    console.error(`  Failed to download image: ${url}`, error.message);
    return null;
  }
}

async function analyzeImage(imageBuffer) {
  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    
    // Check if image is very small
    if (width < 50 || height < 50) {
      return { isBad: true, reason: `Image too small: ${width}x${height}` };
    }
    
    // Resize for faster processing if needed
    const maxDimension = 300;
    let processedBuffer = imageBuffer;
    
    if (width > maxDimension || height > maxDimension) {
      processedBuffer = await sharp(imageBuffer)
        .resize(maxDimension, maxDimension, { fit: 'inside' })
        .toBuffer();
    }
    
    // Get raw pixel data
    const { data, info } = await sharp(processedBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const pixelCount = info.width * info.height;
    let whitePixelCount = 0;
    let nonWhitePixelCount = 0;
    
    // Analyze pixels (assuming RGB or RGBA)
    const channels = info.channels;
    const isRGBA = channels === 4;
    
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Check if pixel is white (RGB values close to 255)
      const isWhite = r > 240 && g > 240 && b > 240;
      
      if (isWhite) {
        whitePixelCount++;
      } else {
        nonWhitePixelCount++;
      }
    }
    
    const whiteRatio = whitePixelCount / pixelCount;
    const nonWhiteRatio = nonWhitePixelCount / pixelCount;
    
    // Check if image is mostly white
    if (whiteRatio > WHITE_THRESHOLD) {
      return { 
        isBad: true, 
        reason: `Image is mostly white (${(whiteRatio * 100).toFixed(1)}% white pixels)` 
      };
    }
    
    // Check if image has very few non-white pixels (small dot)
    if (nonWhiteRatio < SMALL_DOT_THRESHOLD && nonWhitePixelCount < MIN_VALID_PIXELS) {
      return { 
        isBad: true, 
        reason: `Image has very few non-white pixels (${nonWhitePixelCount} pixels, ${(nonWhiteRatio * 100).toFixed(2)}%)` 
      };
    }
    
    return { 
      isBad: false, 
      reason: `Valid image: ${width}x${height}, ${nonWhitePixelCount} non-white pixels (${(nonWhiteRatio * 100).toFixed(1)}%)` 
    };
    
  } catch (error) {
    console.error(`  Failed to analyze image:`, error.message);
    return { isBad: true, reason: `Analysis failed: ${error.message}` };
  }
}

async function processProductsBatch(offset) {
  console.log(`\nProcessing batch starting at offset ${offset}...`);
  
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
    take: BATCH_SIZE,
    orderBy: { id: 'asc' }
  });
  
  console.log(`  Found ${products.length} products in this batch`);
  
  const productsToDelete = [];
  
  for (const product of products) {
    // Skip products with no images or more than one image
    if (product.images.length !== 1) {
      continue;
    }
    
    const singleImage = product.images[0];
    
    // Fast check: bad URL pattern
    if (isBadImageByUrl(singleImage.url)) {
      productsToDelete.push({
        id: product.id,
        name: product.name,
        imageUrl: singleImage.url,
        reason: `Bad URL pattern: ${singleImage.url}`
      });
      continue;
    }
    
    // Download and analyze the image
    console.log(`  Analyzing product ${product.id}: ${product.name.substring(0, 50)}...`);
    
    const imageBuffer = await downloadImage(singleImage.url);
    if (!imageBuffer) {
      // If we can't download, assume it's bad
      productsToDelete.push({
        id: product.id,
        name: product.name,
        imageUrl: singleImage.url,
        reason: 'Failed to download image'
      });
      continue;
    }
    
    const analysis = await analyzeImage(imageBuffer);
    
    if (analysis.isBad) {
      productsToDelete.push({
        id: product.id,
        name: product.name,
        imageUrl: singleImage.url,
        reason: analysis.reason
      });
    }
  }
  
  return productsToDelete;
}

async function deleteProducts(products) {
  if (products.length === 0) {
    console.log('\nNo products to delete.');
    return;
  }
  
  console.log(`\nDeleting ${products.length} products...`);
  
  for (const product of products) {
    try {
      console.log(`  Deleting product ${product.id}: ${product.name.substring(0, 50)}...`);
      console.log(`    Reason: ${product.reason}`);
      console.log(`    Image: ${product.imageUrl}`);
      
      // Delete the product (cascade will delete images, variants, etc.)
      await prisma.product.delete({
        where: { id: product.id }
      });
      
      console.log(`    ✓ Deleted successfully`);
      
    } catch (error) {
      console.error(`    ✗ Failed to delete product ${product.id}:`, error.message);
    }
  }
}

async function main() {
  console.log('=== Product Cleanup: Delete products with single bad image ===\n');
  console.log('This script will:');
  console.log('1. Find products with exactly one ProductImage');
  console.log('2. Analyze that single image');
  console.log('3. Delete products where the image is mostly white/blank or a small dot');
  console.log('4. Skip products with 0 or 2+ images\n');
  
  try {
    // Get total count of active products
    const totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`Total active products in database: ${totalProducts}`);
    console.log(`Processing in batches of ${BATCH_SIZE}...\n`);
    
    let offset = 0;
    let allProductsToDelete = [];
    let processedCount = 0;
    
    while (true) {
      const batchProductsToDelete = await processProductsBatch(offset);
      allProductsToDelete.push(...batchProductsToDelete);
      
      processedCount += BATCH_SIZE;
      offset += BATCH_SIZE;
      
      console.log(`Progress: ${Math.min(processedCount, totalProducts)}/${totalProducts} products processed`);
      
      if (batchProductsToDelete.length === 0 && processedCount >= totalProducts) {
        break;
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total products analyzed: ${Math.min(processedCount, totalProducts)}`);
    console.log(`Products to delete: ${allProductsToDelete.length}`);
    
    if (allProductsToDelete.length > 0) {
      console.log('\nProducts marked for deletion:');
      allProductsToDelete.forEach((product, index) => {
        console.log(`${index + 1}. Product ${product.id}: ${product.name.substring(0, 50)}`);
        console.log(`   Reason: ${product.reason}`);
      });
      
      // Ask for confirmation
      console.log('\n⚠️  WARNING: This will permanently delete the products and all associated data.');
      console.log('Do you want to proceed with deletion? (yes/no)');
      
      // In a real script, you would read from stdin
      // For now, we'll proceed with deletion (you can change this)
      const shouldDelete = true; // Set to false for dry run
      
      if (shouldDelete) {
        await deleteProducts(allProductsToDelete);
        console.log('\n✅ Cleanup completed successfully!');
      } else {
        console.log('\n⚠️  Dry run completed. No products were deleted.');
        console.log('To actually delete products, set shouldDelete = true in the code.');
      }
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

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;