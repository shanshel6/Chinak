import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function checkDb() {
    const products = await prisma.product.findMany({
        take: 5,
        where: {
            OR: [
                { specs: { contains: 'ط§ظ„ظ…ط§ط±ظƒط©' } },
                { specs: { contains: 'الماركة' } }
            ]
        }
    });

    const options = await prisma.productOption.findMany({
        take: 5,
        where: {
            OR: [
                { name: { contains: 'ط§ظ„ظ…ط§ط±ظƒط©' } },
                { name: { contains: 'الماركة' } }
            ]
        }
    });

    let output = "DB Check Results:\n";
    output += `Found ${products.length} products with relevant specs.\n`;
    products.forEach(p => {
        output += `Product ID: ${p.id}, Name: ${p.name}\nSpecs: ${p.specs}\n\n`;
    });

    output += `Found ${options.length} options with relevant names.\n`;
    options.forEach(o => {
        output += `Option ID: ${o.id}, Name: ${o.name}\nValues: ${o.values}\n\n`;
    });

    console.log(output);
    fs.writeFileSync('db_check_result.txt', output);
}

checkDb()
    .catch(e => fs.writeFileSync('db_check_result.txt', `Error: ${e.message}`))
    .finally(async () => {
        await prisma.$disconnect();
    });
