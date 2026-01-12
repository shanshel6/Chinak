import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { processProductAI } from '../services/aiService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../prismaClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

async function backfillAI() {
  console.log('Starting AI backfill for existing products...');
  
  if (!process.env.SILICONFLOW_API_KEY || !process.env.HUGGINGFACE_API_KEY) {
    console.error('ERROR: SILICONFLOW_API_KEY or HUGGINGFACE_API_KEY not found in .env');
    process.exit(1);
  }

  // Use raw query to find products without embeddings or without aiMetadata
  const productsToProcess = await prisma.$queryRaw`
    SELECT id, name, "aiMetadata" 
    FROM "Product" 
    WHERE "aiMetadata" IS NULL OR embedding IS NULL
  `;

  console.log(`Found ${productsToProcess.length} products to process.`);

  for (const product of productsToProcess) {
    console.log(`Processing product ${product.id}: ${product.name}...`);
    try {
      await processProductAI(product.id);
      console.log(`Successfully processed product ${product.id}`);
    } catch (error) {
      console.error(`Failed to process product ${product.id}:`, error.message);
    }
    // 2-second delay to be safe with SiliconFlow free tier
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('AI backfill completed!');
  process.exit(0);
}

backfillAI();
