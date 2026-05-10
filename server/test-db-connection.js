import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL_SSL = 'postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway?sslmode=require';
const DATABASE_URL_NO_SSL = 'postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway';

console.log('Testing database connection...');

async function testConnection(url, description) {
  console.log(`\n--- Testing ${description} ---`);
  console.log('Database URL:', url.replace(/:[^:@]+@/, ':****@'));
  
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: url
      }
    }
  });
  
  try {
    console.log('Attempting to connect...');
    await prisma.$connect();
    console.log('✓ Database connection successful!');
    
    // Test a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✓ Query test successful:', result);
    
    await prisma.$disconnect();
    console.log('✓ Disconnected successfully');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    console.error('Error code:', error.code);
    await prisma.$disconnect();
    return false;
  }
}

async function runTests() {
  const sslResult = await testConnection(DATABASE_URL_SSL, 'with SSL (sslmode=require)');
  const noSslResult = await testConnection(DATABASE_URL_NO_SSL, 'without SSL');
  
  console.log('\n=== Summary ===');
  console.log('SSL connection:', sslResult ? 'SUCCESS' : 'FAILED');
  console.log('No SSL connection:', noSslResult ? 'SUCCESS' : 'FAILED');
  
  if (sslResult) {
    console.log('\n✓ Use SSL connection in batch file');
  } else if (noSslResult) {
    console.log('\n✓ Use non-SSL connection in batch file (remove ?sslmode=require)');
  } else {
    console.log('\n✗ Neither connection method worked. Check if database is running and accessible.');
  }
  
  process.exit(sslResult || noSslResult ? 0 : 1);
}

runTests();
