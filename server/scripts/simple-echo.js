console.log('Script starting...');
console.log('Args:', process.argv);

// Try to import prisma
try {
  console.log('Attempting to import prisma...');
  const prisma = await import('../prismaClient.js');
  console.log('Prisma imported successfully');
} catch (error) {
  console.error('Error importing prisma:', error.message);
}

console.log('Script ending...');