import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      await prisma.storeSettings.create({
        data: {
          id: 1,
          storeName: 'My Store',
          airShippingRate: 15400,
          seaShippingRate: 182000,
          airShippingMinFloor: 5000
        }
      });
      console.log('Default settings created');
    } else {
      console.log('Settings already exist');
    }
  } catch (error) {
    console.error('Error seeding settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();