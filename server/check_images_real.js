import prisma from './prismaClient.js';

async function checkImageSizes() {
  try {
    console.log('Fetching image sizes...');
    const images = await prisma.productImage.findMany({
      select: { 
        id: true,
        productId: true,
        url: true 
      }
    });
    
    console.log(`Found ${images.length} images.`);
    
    images.forEach(img => {
      const sizeKB = Math.round(img.url.length / 1024);
      console.log(`Image ID: ${img.id}, Product ID: ${img.productId}, Size: ${sizeKB} KB, Start: ${img.url.substring(0, 50)}...`);
    });
    
  } catch (err) {
    console.error('Error fetching image sizes:', err);
  } finally {
    await prisma.$disconnect();
  }
}

checkImageSizes();
