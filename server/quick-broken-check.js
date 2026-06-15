import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function quickBrokenCheck() {
  console.log('🚀 QUICK BROKEN IMAGE CHECK (10 products)\n');
  
  try {
    // Get just 10 products with images
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
      take: 10,
      orderBy: { id: 'asc' }
    });
    
    console.log(`📊 Checking ${products.length} products\n`);
    
    let totalImages = 0;
    let brokenImages = 0;
    let accessibleImages = 0;
    const productsWithAllBrokenImages = [];
    
    // Check each product
    for (const product of products) {
      console.log(`\n📦 Product ID: ${product.id}`);
      console.log(`   Name: ${product.name?.substring(0, 60)}...`);
      console.log(`   Image count: ${product.images.length}`);
      
      totalImages += product.images.length;
      let productBrokenCount = 0;
      
      // Check each image
      for (let i = 0; i < product.images.length; i++) {
        const image = product.images[i];
        try {
          const response = await axios.head(image.url, {
            timeout: 3000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            validateStatus: () => true
          });
          
          if (response.status === 200) {
            accessibleImages++;
            console.log(`   ✅ Image ${i+1}: Accessible (Status: 200)`);
          } else {
            brokenImages++;
            productBrokenCount++;
            console.log(`   ❌ Image ${i+1}: Broken (Status: ${response.status})`);
          }
        } catch (error) {
          brokenImages++;
          productBrokenCount++;
          console.log(`   ❌ Image ${i+1}: Error - ${error.message}`);
        }
      }
      
      // Check if all images are broken
      if (product.images.length > 0 && productBrokenCount === product.images.length) {
        productsWithAllBrokenImages.push(product.id);
        console.log(`   ⚠️  ALL images broken - Product should be deleted!`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 QUICK CHECK RESULTS:');
    console.log('='.repeat(60));
    console.log(`Total products checked: ${products.length}`);
    console.log(`Total images checked: ${totalImages}`);
    console.log(`Accessible images: ${accessibleImages}`);
    console.log(`Broken images: ${brokenImages}`);
    console.log(`Broken image rate: ${totalImages > 0 ? ((brokenImages / totalImages) * 100).toFixed(1) : 0}%`);
    console.log(`Products with ALL broken images: ${productsWithAllBrokenImages.length}`);
    
    if (productsWithAllBrokenImages.length > 0) {
      console.log(`\n⚠️  Products to delete: ${productsWithAllBrokenImages.join(', ')}`);
    }
    
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
            console.log(`   URL: ${image.url.substring(0, 100)}...`);
          } else {
            console.log(`❌ First image broken (Status: ${response.status})`);
            console.log(`   URL: ${image.url.substring(0, 100)}...`);
          }
        } catch (error) {
          console.log(`❌ Error checking image: ${error.message}`);
          console.log(`   URL: ${image.url.substring(0, 100)}...`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

quickBrokenCheck();