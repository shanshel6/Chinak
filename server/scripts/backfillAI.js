import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { processProductEmbedding, processProductAI } from '../services/aiService.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../prismaClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

async function backfillAI() {
  console.log('Starting AI backfill for existing products...');
  try {
    await prisma.$connect();
    console.log('Connected to database.');
  } catch (e) {
    console.error('Failed to connect to database:', e);
    process.exit(1);
  }
  
  if (!process.env.DEEPINFRA_API_KEY && !process.env.HUGGINGFACE_API_KEY) {
    console.error('ERROR: No embedding provider configured (set DEEPINFRA_API_KEY or HUGGINGFACE_API_KEY)');
    process.exit(1);
  }

  try {
    console.log('Querying database for missing AI data...');
    const productsToProcess = await prisma.$queryRaw`
    SELECT id, name, "aiMetadata", (embedding IS NULL) as "missingEmbedding"
    FROM "Product" 
    WHERE embedding IS NULL OR ("aiMetadata" IS NULL AND ${!!process.env.DEEPINFRA_API_KEY} = true)
  `;

  console.log(`Found ${productsToProcess.length} products to process.`);

  for (const product of productsToProcess) {
    console.log(`Processing product ${product.id}: ${product.name}...`);
    try {
      // Prioritize full AI processing if metadata is missing (this also generates embedding)
      if (!product.aiMetadata && process.env.DEEPINFRA_API_KEY) {
        await processProductAI(product.id);
      } else if (product.missingEmbedding) {
        // If only embedding is missing
        await processProductEmbedding(product.id);
      }
      console.log(`Successfully processed product ${product.id}`);
    } catch (error) {
      console.error(`Failed to process product ${product.id}:`, error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

    console.log('AI backfill completed!');
  } catch (error) {
    console.error('Fatal error in backfillAI:', error);
  } finally {
    await prisma.$disconnect();
  }
  process.exit(0);
}

backfillAI();
