
const prisma = require('./prismaClient.cjs');
require('dotenv').config();

async function main() {
  const products = await prisma.product.findMany({
    take: 5,
    select: { name: true }
  });
  
  products.forEach(p => {
    console.log(`Name: ${p.name}`);
    const regaliIndex = p.name.indexOf('رجالي');
    if (regaliIndex !== -1) {
      const regaliPart = p.name.substring(regaliIndex, regaliIndex + 5);
      console.log(`  'رجالي' part: ${regaliPart}`);
      for (let i = 0; i < regaliPart.length; i++) {
        console.log(`    Char ${i}: ${regaliPart[i]} (U+${regaliPart.charCodeAt(i).toString(16).padStart(4, '0')})`);
      }
    }
  });

  const myRegali = 'رجالي';
  console.log(`My 'رجالي':`);
  for (let i = 0; i < myRegali.length; i++) {
    console.log(`    Char ${i}: ${myRegali[i]} (U+${myRegali.charCodeAt(i).toString(16).padStart(4, '0')})`);
  }

  await prisma.$disconnect();
}

main();
