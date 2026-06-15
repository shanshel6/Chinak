#!/usr/bin/env node

/**
 * Verbose test version of cleanup script
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

async function main() {
  console.log('=== VERBOSE TEST - Cleanup Bad Products ===\n');
  
  try {
    // Get total count
    const totalProducts = await prisma.product.count({
      where: {
        isActive: true,
        status: 'PUBLISHED'
      }
    });
    
    console.log(`Total active products: ${totalProducts.toLocaleString()}`);
    console.log(`Testing with first 50 products only...\n`);
    
    // Test with first 50 products only
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
      take: 50,
      orderBy: { id: 'asc' }
    });
    
    console.log(`Fetched ${products.length} products for testing.\n`);
    
    let singleImageCount = 0;
    let badImageCount = 0;
    const productsToDelete = [];
    
    for (const product of products) {
      console.log(`Product ${product.id}: ${product.name.substring(0, 40)}...`);
      console.log(`  Images: ${product.images.length}`);
      
      if (product.images.length === 1) {
        singleImageCount++;
        const imageUrl = product.images[0].url;
        console.log(`  Single image URL: ${imageUrl}`);
        
        const isBad = isBadImageByUrl(imageUrl);
        console.log(`  Is bad image: ${isBad ? 'YES' : 'no'}`);
        
        if (isBad) {
          badImageCount++;
          productsToDelete.push({
            id: product.id,
            name: product.name,
            imageUrl: imageUrl
          });
        }
      }
      
      console.log('');
    }
    
    console.log('\n=== TEST RESULTS ===');
    console.log(`Products analyzed: ${products.length}`);
    console.log(`Products with single image: ${singleImageCount}`);
    console.log(`Products with single bad image: ${badImageCount}`);
    
    if (productsToDelete.length > 0) {
      console.log('\nProducts that would be deleted:');
      productsToDelete.forEach((p, i) => {
        console.log(`${i + 1}. Product ${p.id}: ${p.name.substring(0, 50)}...`);
        console.log(`   Image: ${p.imageUrl}`);
      });
    } else {
      console.log('\n✅ No products with single bad images found in first 50 products.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}