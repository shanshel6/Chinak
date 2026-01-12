import prisma from './prismaClient.js';

async function checkProductImages() {
  const productId = 15;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: true }
  });

  if (product) {
    console.log('Product found:', product.name);
    console.log('Main image:', product.image.substring(0, 50) + '...');
    console.log('Gallery images count:', product.images.length);
    product.images.forEach((img, i) => {
      console.log(`Image ${i} (${img.type}):`, img.url.substring(0, 50) + '...');
    });
  } else {
    console.log('Product not found');
  }
  
  await prisma.$disconnect();
}

checkProductImages();
