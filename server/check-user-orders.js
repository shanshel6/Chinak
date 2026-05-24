import prisma from './prismaClient.js';

async function checkUserOrders() {
  try {
    // 1. Get a user who actually has orders
    const orderWithUser = await prisma.order.findFirst({
      include: { user: true }
    });

    if (!orderWithUser) {
      console.log('No orders found in database.');
      return;
    }

    const user = orderWithUser.user;
    console.log(`Testing with User: ${user.name} (ID: ${user.id})`);

    // 2. Try fetching via prisma just like index.js does
    const orders = await prisma.order.findMany({
      where: { userId: user.id },
      include: {
        items: { 
          include: { 
            product: true
          } 
        },
        address: true
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`✅ Prisma fetch successful for User ID ${user.id}. Found ${orders.length} orders.`);
    if (orders.length > 0) {
      console.log('First Order ID:', orders[0].id);
      console.log('Payment Method:', orders[0].paymentMethod);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUserOrders();
