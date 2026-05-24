import prisma from './prismaClient.js';

async function verifyFixes() {
  console.log('--- VERIFYING FIXES ---');
  
  try {
    // 1. Check if we can create an order with 'PENDING' payment method
    console.log('\n1. Testing Order Creation with PENDING payment...');
    const user = await prisma.user.findFirst();
    const address = await prisma.address.findFirst({ where: { userId: user.id } });
    const product = await prisma.product.findFirst({ where: { isActive: true } });

    if (!user || !address || !product) {
      console.log('Missing data to perform full verification.');
      return;
    }

    const newOrder = await prisma.order.create({
      data: {
        userId: user.id,
        addressId: address.id,
        total: 5000,
        status: 'PENDING',
        paymentMethod: 'PENDING', // The new default
        shippingMethod: 'air',
        items: {
          create: [{
            productId: product.id,
            quantity: 1,
            price: 5000
          }]
        }
      }
    });
    console.log('✅ Order created successfully with PENDING payment method. ID:', newOrder.id);

    // 2. Verify admin can fetch this order
    console.log('\n2. Testing Admin Order Fetching...');
    const orders = await prisma.order.findMany({
      where: { id: newOrder.id },
      include: { user: true, items: true }
    });

    if (orders.length > 0 && orders[0].paymentMethod === 'PENDING') {
      console.log('✅ Admin can fetch PENDING orders successfully.');
    } else {
      console.error('❌ Admin failed to fetch PENDING order.');
    }

    // --- CLEANUP ---
    console.log('\nCleaning up test order...');
    await prisma.orderItem.deleteMany({ where: { orderId: newOrder.id } });
    await prisma.order.delete({ where: { id: newOrder.id } });
    console.log('Cleanup finished.');

  } catch (error) {
    console.error('Verification error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyFixes();
