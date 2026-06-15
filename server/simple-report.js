import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function simpleReport() {
  console.log('📊 SIMPLE DATABASE REPORT\n');
  
  try {
    // Get basic counts
    const totalProducts = await prisma.product.count();
    const productsWithImages = await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    const productsWithoutImages = totalProducts - productsWithImages;
    const totalImages = await prisma.productImage.count();
    
    console.log('BASIC STATISTICS:');
    console.log('='.repeat(40));
    console.log(`Total products: ${totalProducts.toLocaleString()}`);
    console.log(`Products with images: ${productsWithImages.toLocaleString()}`);
    console.log(`Products WITHOUT images: ${productsWithoutImages.toLocaleString()}`);
    console.log(`Total images: ${totalImages.toLocaleString()}`);
    
    if (productsWithoutImages > 0) {
      console.log(`\n⚠️  IMMEDIATE ACTION NEEDED:`);
      console.log(`   Delete ${productsWithoutImages.toLocaleString()} products with NO images`);
      console.log(`   Run: DELETE FROM "Product" WHERE id IN (SELECT id FROM "Product" p WHERE NOT EXISTS (SELECT 1 FROM "ProductImage" pi WHERE pi."productId" = p.id))`);
    }
    
    // Check specific products
    console.log('\n' + '='.repeat(40));
    console.log('SPECIFIC PRODUCTS CHECK:');
    console.log('='.repeat(40));
    
    const specificProducts = await prisma.product.findMany({
      where: {
        id: { in: [228365, 114979, 354, 363] }
      },
      include: {
        images: {
          select: { url: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    console.log(`Found ${specificProducts.length} specific products\n`);
    
    for (const product of specificProducts) {
      console.log(`Product ID: ${product.id}`);
      console.log(`Name: ${product.name?.substring(0, 60)}...`);
      console.log(`Image count: ${product.images.length}`);
      
      if (product.images.length === 0) {
        console.log(`❌ NO IMAGES - DELETE THIS PRODUCT`);
      } else {
        console.log(`First image URL: ${product.images[0].url.substring(0, 80)}...`);
      }
      console.log('');
    }
    
    // Sample of products with many images (likely broken)
    console.log('='.repeat(40));
    console.log('PRODUCTS WITH 20+ IMAGES (likely broken):');
    console.log('='.repeat(40));
    
    const productsWithManyImages = await prisma.product.findMany({
      where: {
        images: {
          some: {}
        }
      },
      include: {
        images: {
          select: { url: true },
          orderBy: { order: 'asc' }
        }
      },
      take: 20,
      orderBy: { id: 'asc' }
    });
    
    // Filter for products with exactly 20 images (common broken pattern)
    const likelyBroken = productsWithManyImages.filter(p => p.images.length === 20);
    
    console.log(`Found ${likelyBroken.length} products with exactly 20 images (suspicious)\n`);
    
    for (let i = 0; i < Math.min(5, likelyBroken.length); i++) {
      const product = likelyBroken[i];
      console.log(`${i+1}. Product ID: ${product.id}`);
      console.log(`   Name: ${product.name?.substring(0, 50)}...`);
      console.log(`   Images: ${product.images.length}`);
      console.log(`   First URL: ${product.images[0].url.substring(0, 70)}...\n`);
    }
    
    if (likelyBroken.length > 0) {
      console.log(`💡 These ${likelyBroken.length} products likely have ALL broken images`);
      console.log(`   Estimated total similar products: ${Math.round(productsWithImages * (likelyBroken.length / productsWithManyImages.length)).toLocaleString()}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

simpleReport();