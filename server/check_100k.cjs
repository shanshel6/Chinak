const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
    const all = await prisma.storeSettings.findMany();
    console.log('Current settings:', JSON.stringify(all, null, 2));
    
    await prisma.storeSettings.update({
      where: { id: 1 },
      data: { airShippingRate: 15400 }
    });
    console.log('Updated airShippingRate to 15400');
    
    const updated = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    console.log('New settings:', JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
