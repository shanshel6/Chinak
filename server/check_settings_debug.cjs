
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSettings() {
  try {
    const settings = await prisma.storeSettings.findMany();
    console.log(`Found ${settings.length} settings record(s)`);
    console.log(JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error fetching settings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSettings();
