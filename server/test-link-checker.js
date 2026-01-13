import { checkAllProductLinks } from './services/linkCheckerService.js';
import prisma from './prismaClient.js';

async function runTest() {
  console.log('--- Starting Manual Link Check Test ---');
  
  // First, let\'s see what products we have with 1688 links
  const productsBefore = await prisma.product.findMany({
    where: {
      purchaseUrl: {
        contains: '1688.com'
      },
      isActive: true
    },
    select: {
      id: true,
      name: true,
      purchaseUrl: true,
      status: true
    }
  });

  console.log(`Found ${productsBefore.length} active products with 1688 links.`);
  productsBefore.forEach(p => console.log(`- [${p.id}] ${p.name}: ${p.purchaseUrl}`));

  console.log('\nRunning checkAllProductLinks()...');
  await checkAllProductLinks();
  
  console.log('\n--- Test Completed ---');
  console.log('Check the server console or wait for background processes to finish.');
  
  // Wait a bit for the background checks to complete since they have delays
  // But checkAllProductLinks itself is async and we await it, though it might spawn background tasks
  // Looking at the implementation, it awaits each fetch.
  
  const productsAfter = await prisma.product.findMany({
    where: {
      purchaseUrl: {
        contains: '1688.com'
      }
    },
    select: {
      id: true,
      name: true,
      isActive: true,
      status: true
    }
  });

  console.log('\nFinal Status:');
  productsAfter.forEach(p => {
    console.log(`- [${p.id}] ${p.name}: isActive=${p.isActive}, status=${p.status}`);
  });

  await prisma.$disconnect();
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
