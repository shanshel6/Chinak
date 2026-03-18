import prisma from '../prismaClient.js';
import { testCropObject } from '../services/clipService.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Setup HF endpoint
process.env.HF_ENDPOINT = 'https://hf-mirror.com';

async function saveRawImage(rawImage, filepath) {
  try {
    // We need to convert Xenova's RawImage to a standard format to save it.
    // For simplicity in a test script, we'll use Jimp if available, or just log.
    // However, since we might not have an easy image writer setup that accepts RawImage,
    // we will save it as raw pixel data or rely on a helper if one existed.
    // Since Jimp is in package.json, let's use it.
    const { Jimp } = await import('jimp');
    
    // RawImage data is usually RGB. Jimp expects RGBA.
    const width = rawImage.width;
    const height = rawImage.height;
    const channels = rawImage.channels;
    
    const jimpImage = new Jimp({ width, height, color: 0xffffffff });
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const r = rawImage.data[idx];
        const g = rawImage.data[idx + 1];
        const b = rawImage.data[idx + 2];
        const a = channels === 4 ? rawImage.data[idx + 3] : 255;
        
        const color = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
        jimpImage.setPixelColor(color, x, y);
      }
    }
    
    await jimpImage.write(filepath);
    console.log(`Saved: ${filepath}`);
  } catch (err) {
    console.error(`Failed to save image ${filepath}:`, err.message);
  }
}

async function main() {
  const outputDir = path.resolve('./crop_tests');
  await fs.mkdir(outputDir, { recursive: true });
  console.log(`Test outputs will be saved to: ${outputDir}`);

  await prisma.$connect();
  try {
    // Get 5 random products with images
    const products = await prisma.$queryRawUnsafe(`
      SELECT id, name, image FROM "Product" 
      WHERE image IS NOT NULL AND image != '' AND image != 'null'
      ORDER BY RANDOM() 
      LIMIT 5
    `);

    if (!products || products.length === 0) {
      console.log('No products found to test.');
      return;
    }

    console.log(`Found ${products.length} products to test.`);

    for (const product of products) {
      console.log(`\nTesting Product ID: ${product.id}`);
      console.log(`URL: ${product.image}`);

      try {
        const { original, cropped } = await testCropObject(product.image);
        
        if (original === cropped) {
          console.log(`Result: No crop was applied (full image used).`);
        } else {
          console.log(`Result: Crop applied! Original size: ${original.width}x${original.height}, Cropped size: ${cropped.width}x${cropped.height}`);
        }

        // Save original
        await saveRawImage(original, path.join(outputDir, `${product.id}_original.jpg`));
        // Save cropped (if different)
        if (original !== cropped) {
            await saveRawImage(cropped, path.join(outputDir, `${product.id}_cropped.jpg`));
        }

      } catch (err) {
        console.error(`Error processing product ${product.id}:`, err.message);
      }
    }

  } finally {
    await prisma.$disconnect();
    console.log('\nTest complete.');
  }
}

main().catch(console.error);
