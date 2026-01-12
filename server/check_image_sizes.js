import prisma from './prismaClient.js';

async function checkImageSizes() {
  try {
    const images = await prisma.productImage.findMany({
      select: { url: true }
    });
    
    if (images.length === 0) {
      console.log('No images found.');
      return;
    }
    
    let totalLength = 0;
    let base64Count = 0;
    let maxLen = 0;
    
    images.forEach(img => {
      const len = img.url.length;
      totalLength += len;
      if (img.url.startsWith('data:image')) base64Count++;
      if (len > maxLen) maxLen = len;
    });
    
    console.log(`Total images: ${images.length}`);
    console.log(`Base64 images: ${base64Count}`);
    console.log(`Average URL length: ${totalLength / images.length}`);
    console.log(`Max URL length: ${maxLen}`);
    
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkImageSizes();
