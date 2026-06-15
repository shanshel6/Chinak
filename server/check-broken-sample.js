import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkBrokenImages() {
  console.log('🔍 Checking for broken images (sample of 100 products)...\n');
  
  try {
    // Get a sample of products with images
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        status: 'PUBLISHED',
        images: {
          some: {}
        }
      },
      include: {
        images: {
          select: { url: true, id: true },
          orderBy: { order: 'asc' }
        }
      },
      take: 100, // Sample size
      orderBy: { id: 'asc' }
    });
    
    console.log(`📊 Sample size: ${products.length} products\n`);
    
    let totalImages = 0;
    let brokenImages = 0;
    let accessibleImages = 0;
    const productsWithAllBrokenImages = [];
    
    // Check each product's images
    for (const product of products) {
      const imageCount = product.images.length;
      totalImages += imageCount;
      
      let brokenCount = 0;
      
      // Check each image URL
      for (const image of product.images) {
        try {
          // Use HEAD request for speed
          const response = await axios.head(image.url, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true // Don't throw on any status code
          });
          
          if (response.status === 200) {
            accessibleImages++;
          } else {
            brokenImages++;
            brokenCount++;
            console.log(`❌ Broken image: Product ${product.id}, Image ${image.id}, Status: ${response.status}, URL: ${image.url.substring(0, 100)}...`);
          }
        } catch (error) {
          brokenImages++;
          brokenCount++;
          console.log(`❌ Error checking image: Product ${product.id}, Image ${image.id}, Error: ${error.message}, URL: ${image.url.substring(0, 100)}...`);
        }
      }
      
      // If all images are broken, mark product for deletion
      if (imageCount > 0 && brokenCount === imageCount) {
        productsWithAllBrokenImages.push(product.id);
        console.log(`⚠️  Product ${product.id} has ALL broken images (${brokenCount}/${imageCount}) - should be deleted!`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 SAMPLE RESULTS (100 products):');
    console.log('='.repeat(60));
    console.log(`Total products checked: ${products.length}`);
    console.log(`Total images checked: ${totalImages}`);
    console.log(`Accessible images: ${accessibleImages}`);
    console.log(`Broken images: ${brokenImages}`);
    console.log(`Products with all broken images: ${productsWithAllBrokenImages.length}`);
    
    if (productsWithAllBrokenImages.length > 0) {
      console.log(`\n⚠️  Products to delete (all images broken): ${productsWithAllBrokenImages.join(', ')}`);
    }
    
    // Calculate estimated totals based on sample
    const brokenImageRate = totalImages > 0 ? (brokenImages / totalImages) : 0;
    const estimatedTotalBrokenImages = Math.round(413315 * brokenImageRate);
    
    const productDeletionRate = products.length > 0 ? (productsWithAllBrokenImages.length / products.length) : 0;
    const estimatedProductsToDelete = Math.round(192831 * productDeletionRate);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 ESTIMATED TOTALS (based on sample):');
    console.log('='.repeat(60));
    console.log(`Estimated total broken images: ${estimatedTotalBrokenImages.toLocaleString()} (${(brokenImageRate * 100).toFixed(2)}%)`);
    console.log(`Estimated products to delete: ${estimatedProductsToDelete.toLocaleString()} (${(productDeletionRate * 100).toFixed(2)}%)`);
    
    // Check the specific products mentioned by user
    console.log('\n' + '='.repeat(60));
    console.log('🔍 Checking specific products (228365, 114979):');
    console.log('='.repeat(60));
    
    const specificProducts = await prisma.product.findMany({
      where: {
        id: { in: [228365, 114979] }
      },
      include: {
        images: {
          select: { url: true, id: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    for (const product of specificProducts) {
      console.log(`\nProduct ID: ${product.id}`);
      console.log(`Name: ${product.name?.substring(0, 80)}...`);
      console.log(`Image count: ${product.images.length}`);
      
      if (product.images.length === 0) {
        console.log(`❌ NO IMAGES - This product should be deleted!`);
      } else {
        // Check first image
        const image = product.images[0];
        try {
          const response = await axios.head(image.url, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
          });
          
          if (response.status === 200) {
            console.log(`✅ First image accessible (Status: ${response.status})`);
          } else {
            console.log(`❌ First image broken (Status: ${response.status})`);
          }
        } catch (error) {
          console.log(`❌ Error checking image: ${error.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkBrokenImages();