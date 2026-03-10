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
          airShippingMinFloor: 0,
          airShippingThreshold: 30000,
          seaShippingThreshold: 30000
        }
      });
      console.log('Default settings created');
    } else {
      await prisma.storeSettings.update({
        where: { id: 1 },
        data: {
          airShippingThreshold: 30000,
          seaShippingThreshold: 30000,
          airShippingMinFloor: 0
        }
      });
      console.log('Settings updated with new thresholds');
    }
  } catch (error) {
    console.error('Error seeding settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();