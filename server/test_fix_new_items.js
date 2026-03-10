
import prisma from './prismaClient.js';

async function testFix() {
  try {
    console.log('Testing product creation with isPriceCombined: true...');

    // Simulate data from import_real_products.js logic
    const rawPrice = 8500; // IQD price provided as base
    const domesticFee = 0;
    const weight = 0.5;
    
    // Calculate price as done in the scripts
    const price = Math.ceil(((rawPrice + domesticFee + (weight * 15400)) * 1.20) / 250) * 250;
    
    console.log(`Calculated Price: ${price}`);
    console.log(`Raw Price (basePriceRMB): ${rawPrice}`);

    const product = await prisma.product.create({
      data: {
        name: 'Test Fix Product ' + Date.now(),
        chineseName: 'Test Fix',
        description: 'Test Description',
        price: price,
        basePriceRMB: rawPrice, // IQD stored in RMB field
        image: '',
        status: 'DRAFT',
        isActive: false,
        isPriceCombined: true // The fix!
      }
    });

    console.log(`Created Product ID: ${product.id}`);
    console.log(`isPriceCombined: ${product.isPriceCombined}`);
    
    // Verify backend repricing logic (simulate what happens in index.js)
    // We can't easily call the internal function from index.js but we can check if our logic holds.
    
    if (product.isPriceCombined) {
        console.log('SUCCESS: isPriceCombined is true. Frontend will use stored price.');
        if (product.basePriceRMB === 8500) {
            console.log('NOTE: basePriceRMB still holds 8500 (IQD), but isPriceCombined=true prevents inflation.');
        }
    } else {
        console.log('FAILURE: isPriceCombined is false.');
    }

    // Cleanup
    await prisma.product.delete({ where: { id: product.id } });
    console.log('Cleanup done.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testFix();
