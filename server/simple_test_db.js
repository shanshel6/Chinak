
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.join(__dirname, 'db_test_result.txt');

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch (err) {
    // ignore
  }
}

// Clear log file
try {
  fs.writeFileSync(logFile, '');
  log('Log file created');
} catch (err) {
  console.error('Failed to create log file', err);
}

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  try {
    log('Testing DB Connection...');
    const count = await prisma.product.count();
    log(`Product count: ${count}`);

    log('Testing StoreSettings...');
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    log(settings);

    log('Testing Product Fetch (first 1)...');
    const products = await prisma.product.findMany({ take: 1 });
    log(products[0]);
    
    log('DB Test Successful');
  } catch (e) {
    log(`DB Test Failed: ${e.message}`);
    log(e.stack);
  } finally {
    await prisma.$disconnect();
  }
}

main();
