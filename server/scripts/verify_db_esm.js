import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log("Starting verification script...");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not Set");

const prisma = new PrismaClient();

async function verifyDb() {
    try {
        const product = await prisma.product.findFirst({
            orderBy: { id: 'desc' },
            include: {
                options: true,
                variants: true
            }
        });

        if (!product) {
            console.log("No products found.");
            return;
        }

        console.log("\n=== LATEST PRODUCT VERIFICATION ===");
        console.log(`ID: ${product.id}`);
        console.log(`Name (Translated): ${product.name}`);
        console.log(`URL: ${product.purchaseUrl}`);
        
        console.log("\n--- Options ---");
        product.options.forEach(opt => {
            console.log(`Option: ${opt.name}`);
            console.log(`Values (JSON): ${opt.values}`);
        });

        console.log("\n--- Variants (First 3) ---");
        product.variants.slice(0, 3).forEach(v => {
            console.log(`Variant: ${v.combination} | Price: ${v.price}`);
        });

    } catch (error) {
        console.error("Verification failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

verifyDb();
