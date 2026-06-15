import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// Configuration
const BATCH_SIZE = 50; // Smaller batches for better stability
const TIMEOUT = 5000; // 5 seconds

async function checkUrl(url) {
  try {
    const response = await axios.head(url, {
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      validateStatus: (status) => true // Don't throw on 404
    });
    return response.status !== 404;
  } catch (error) {
    // If it's a timeout or connection error, we don't count it as broken
    return true; 
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDeleteMode = args.includes('--delete');

  console.log('================================================');
  console.log('FULL PRODUCT IMAGE CLEANUP');
  console.log('MODE: ' + (isDeleteMode ? 'DELETE MODE' : 'DRY RUN (No deletion)'));
  console.log('================================================\n');

  // Statistics
  let stats = {
    productsChecked: 0,
    noImageProductsFound: 0,
    noImageProductsDeleted: 0,
    allBrokenProductsFound: 0,
    allBrokenProductsDeleted: 0,
    imagesDeleted: 0
  };

  try {
    // 1. Handle products with NO images
    console.log('Step 1: Checking products with NO images...');
    const productsWithNoImages = await prisma.product.findMany({
      where: {
        images: { none: {} }
      },
      select: { id: true }
    });

    stats.noImageProductsFound = productsWithNoImages.length;
    console.log('Found ' + productsWithNoImages.length + ' products with no images.');
    
    if (productsWithNoImages.length > 0) {
      if (isDeleteMode) {
        const ids = productsWithNoImages.map(p => p.id);
        // We delete products that have no images. If they have constraints, we'll just skip them for now
        // but we could also deactivate them.
        let deletedCount = 0;
        for (const id of ids) {
          try {
            await prisma.product.delete({ where: { id } });
            deletedCount++;
          } catch (e) {
            await prisma.product.update({ 
              where: { id }, 
              data: { isActive: false, status: 'DRAFT' } 
            });
          }
        }
        stats.noImageProductsDeleted = deletedCount;
        console.log('Deleted ' + deletedCount + ' products with no images (others deactivated).');
      } else {
        console.log('Dry run: Would delete/deactivate ' + productsWithNoImages.length + ' products.');
      }
    }

    // 2. Handle products with broken images
    console.log('\nStep 2: Checking products with broken images...');
    let skip = 0;

    const totalCount = await prisma.product.count({
      where: { images: { some: {} } }
    });
    console.log('Total products to check: ' + totalCount);

    while (true) {
      const products = await prisma.product.findMany({
        where: { images: { some: {} } },
        include: { images: true },
        take: BATCH_SIZE,
        skip: skip,
        orderBy: { id: 'asc' }
      });

      if (products.length === 0) break;

      for (const product of products) {
        stats.productsChecked++;
        const imageResults = [];
        
        for (const img of product.images) {
            const isGood = await checkUrl(img.url);
            imageResults.push({ id: img.id, url: img.url, isGood });
        }
        
        const allBroken = imageResults.every(res => !res.isGood);
        const brokenImages = imageResults.filter(res => !res.isGood);
        const goodImages = imageResults.filter(res => res.isGood);

        if (allBroken) {
          stats.allBrokenProductsFound++;
          console.log('Product ' + product.id + ' has ALL broken images (' + brokenImages.length + '/' + product.images.length + ').');
          
          if (isDeleteMode) {
            try {
              await prisma.product.delete({ where: { id: product.id } });
              stats.allBrokenProductsDeleted++;
              // No skip++ because the next product will shift into this position
            } catch (err) {
              console.log('  Failed to delete Product ' + product.id + ' (constraints). Deactivating and removing broken images.');
              await prisma.product.update({ 
                where: { id: product.id }, 
                data: { isActive: false, status: 'DRAFT', image: null } 
              });
              await prisma.productImage.deleteMany({ where: { productId: product.id } });
              stats.imagesDeleted += brokenImages.length;
              skip++;
            }
          } else {
            skip++;
          }
        } else if (brokenImages.length > 0) {
          console.log('Product ' + product.id + ' has ' + brokenImages.length + '/' + product.images.length + ' broken images. KEEPING product.');
          
          if (isDeleteMode) {
            const brokenIds = brokenImages.map(bi => bi.id);
            const brokenUrls = brokenImages.map(bi => bi.url);
            
            await prisma.productImage.deleteMany({ where: { id: { in: brokenIds } } });
            stats.imagesDeleted += brokenImages.length;
            console.log('  Deleted ' + brokenImages.length + ' broken images.');

            // Update main image if it was broken
            if (product.image && brokenUrls.includes(product.image)) {
              const firstGoodUrl = goodImages[0].url;
              await prisma.product.update({
                where: { id: product.id },
                data: { image: firstGoodUrl }
              });
              console.log('  Updated main product image to a working one.');
            }
          }
          skip++;
        } else {
          // All images are good
          skip++;
        }

        if (stats.productsChecked % 10 === 0) {
          process.stdout.write('Progress: ' + stats.productsChecked + '/' + totalCount + ' checked...\r');
        }
      }
    }

    console.log('\n\n================================================');
    console.log('FINAL SUMMARY');
    console.log('Total products checked: ' + stats.productsChecked);
    console.log('Products with NO images: ' + stats.noImageProductsFound + (isDeleteMode ? ' (Deleted/Deactivated: ' + stats.noImageProductsDeleted + ')' : ''));
    console.log('Products with ALL broken images: ' + stats.allBrokenProductsFound + (isDeleteMode ? ' (Deleted/Deactivated: ' + stats.allBrokenProductsDeleted + ')' : ''));
    console.log('Individual broken images deleted: ' + stats.imagesDeleted);
    console.log('================================================');
    if (!isDeleteMode) {
      console.log('Run with --delete to actually remove these items.');
    }
    console.log('================================================');

  } catch (error) {
    console.error('\nAn error occurred:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
