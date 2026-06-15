// Simple check from server directory
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Simple database check from server directory...\n');
  
  try {
    // Count total products
    const totalProducts = await prisma.product.count();
    console.log(`Total products: ${totalProducts}`);
    
    // Count products with images
    const productsWithImages = await prisma.product.count({
      where: {
        images: {
          some: {}
        }
      }
    });
    console.log(`Products with images: ${productsWithImages}`);
    
    // Count products without images
    const productsWithoutImages = totalProducts - productsWithImages;
    console.log(`Products without images: ${productsWithoutImages}`);
    
    // Count total images
    const totalImages = await prisma.productImage.count();
    console.log(`Total images: ${totalImages}`);
    
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY:');
    console.log('='.repeat(50));
    console.log(`Total products: ${totalProducts}`);
    console.log(`Products with images: ${productsWithImages}`);
    console.log(`Products without images: ${productsWithoutImages}`);
    console.log(`Total images: ${totalImages}`);
    
    if (productsWithoutImages > 0) {
      console.log(`\n⚠️  WARNING: ${productsWithoutImages} products have NO images and should be deleted!`);
    }
    
    // Check specific products
    console.log('\n' + '='.repeat(50));
    console.log('Checking specific products (228365, 114979):');
    console.log('='.repeat(50));
    
    const specificProducts = await prisma.product.findMany({
      where: {
        id: {
          in: [228365, 114979]
        }
      },
      include: {
        images: {
          select: { id: true, url: true, order: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    
    console.log(`Found ${specificProducts.length} specific products\n`);
    
    for (const product of specificProducts) {
      console.log(`Product ID: ${product.id}`);
      console.log(`Name: ${product.name.substring(0, 80)}...`);
      console.log(`Images: ${product.images.length}`);
      
      if (product.images.length === 0) {
        console.log('❌ NO IMAGES - This product should be deleted!');
      } else {
        console.log('Image URLs:');
        for (const image of product.images) {
          console.log(`  Image ${image.order}: ${image.url.substring(0, 100)}...`);
        }
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();