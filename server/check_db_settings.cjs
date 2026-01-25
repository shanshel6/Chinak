const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  try {
const fs = require('fs');
    const settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    let output = '';
    if (settings) {
      output = `Air Rate: ${settings.airShippingRate}\nSea Rate: ${settings.seaShippingRate}`;
    } else {
      output = 'No settings found';
    }
    fs.writeFileSync('settings_check.log', output);
    console.log('Result written to settings_check.log');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

check();
