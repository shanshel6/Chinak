import pkg from '@prisma/client';
import fs from 'fs';
import { processProductAI } from './services/aiService.js';
import dotenv from 'dotenv';
import prisma from './prismaClient.js';

dotenv.config();

async function main() {
  const content = fs.readFileSync('../recent_products.json', 'utf8');
  
  // The content is a PowerShell dump. We need to extract the part between "[" and "]"
  // after the "Content           : " label.
  const startIndex = content.indexOf('[');
  const endIndex = content.lastIndexOf(']') + 1;
  
  if (startIndex === -1 || endIndex === 0) {
    console.error('Could not find JSON array in file');
    return;
  }
  
  let jsonPart = content.substring(startIndex, endIndex);
  
  // PowerShell output often adds extra newlines and indentation inside the content.
  // We need to clean it up.
  // 1. Remove the line breaks that are followed by lots of spaces (PowerShell formatting)
  jsonPart = jsonPart.replace(/\r?\n\s+/g, ' ');
  // 2. Remove any other weird characters
  jsonPart = jsonPart.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  try {
    const rawData = JSON.parse(jsonPart);
    console.log(`Successfully parsed ${rawData.length} products!`);

    for (const p of rawData) {
      const name = p.name ? p.name.replace(/\n/g, ' ').trim() : 'Unnamed';
      const chineseName = p.chineseName ? p.chineseName.replace(/\n/g, ' ').trim() : null;
      const description = p.description ? p.description.replace(/\n/g, ' ').trim() : null;
      
      let product = await prisma.product.findFirst({
        where: { name: name }
      });

      if (!product) {
        product = await prisma.product.create({
          data: {
            name: name,
            chineseName: chineseName,
            description: description,
            price: (parseFloat(p.price) || 0) * 1.1, // 10% profit markup
            basePriceRMB: parseFloat(p.basePriceRMB) || 0,
            image: p.image || '',
            purchaseUrl: p.purchaseUrl,
            status: 'PUBLISHED',
            isActive: true,
            isFeatured: !!p.isFeatured,
            specs: p.specs,
            storeEvaluation: p.storeEvaluation,
            reviewsCountShown: p.reviewsCountShown,
            videoUrl: p.videoUrl
          }
        });
        console.log(`Imported: ${name}`);
        
        // Trigger AI processing with a small delay for free-tier rate limits
        if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
          try {
            console.log(`  -> AI Processing for ${name}...`);
            await processProductAI(product.id);
            // 2-second delay to be safe with SiliconFlow free tier
            await new Promise(r => setTimeout(r, 2000));
          } catch (aiErr) {
            console.error(`  !! AI Processing failed for ${name}:`, aiErr.message);
          }
        }
      } else {
        console.log(`Skipped (exists): ${name}`);
      }
    }
    console.log('Import finished!');
  } catch (err) {
    console.error('Final attempt to parse failed:', err.message);
    if (typeof jsonPart !== 'undefined') {
      console.log('Cleaned snippet:', jsonPart.substring(0, 500));
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
