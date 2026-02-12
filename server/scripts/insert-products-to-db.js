import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processProductAI } from '../services/aiService.js';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function insertProducts() {
  try {
    // Read the JSON file
    const jsonFilePath = path.join(__dirname, '1688-individual-products-1769617585698.json');
    const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
    
    const products = jsonData.products;
    
    console.log(`Found ${products.length} products to insert...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const productData of products) {
      try {
        console.log(`Processing product: ${productData.product_name}`);
        
        // Map the JSON data to Prisma schema
        const product = await prisma.product.create({
          data: {
            name: productData.product_name,
            price: parseFloat(productData.general_price) || 0,
            basePriceRMB: parseFloat(productData.general_price) || 0,
            image: productData.main_images[0] || '',
            purchaseUrl: productData.url,
            domesticShippingFee: parseFloat(productData.domestic_shipping_fee) || 0,
            deliveryTime: productData.delivery_time || productData.deliveryTime || productData.Delivery_time || null,
            aiMetadata: productData.aiMetadata || productData.ai_metadata || productData.aimetatags || productData.marketing_metadata || null,
            isPriceCombined: true,
            specs: JSON.stringify({
              category: productData.category,
              variants: productData.variants,
              marketing: productData.marketing_metadata
            }),
            // Create product images
            images: {
              create: productData.main_images.map((imageUrl, index) => ({
                url: imageUrl,
                order: index,
                type: 'GALLERY'
              }))
            },
            // Create product options (sizes and colors)
            options: {
              create: [
                {
                  name: 'المقاس',
                  values: JSON.stringify(productData.variants?.sizes || [])
                },
                {
                  name: 'اللون', 
                  values: JSON.stringify(productData.variants?.colors || [])
                }
              ]
            },
            // Create default variant
            variants: {
              create: [
                {
                  combination: 'افتراضي',
                  price: parseFloat(productData.general_price) || 0,
                  weight: 0,
                  length: 0,
                  width: 0,
                  height: 0
                }
              ]
            }
          },
          include: {
            images: true,
            options: true,
            variants: true
          }
        });
        
        console.log(`✅ Product inserted successfully: ${product.name}`);
        successCount++;

        // Trigger AI processing
        if (process.env.SILICONFLOW_API_KEY || process.env.HUGGINGFACE_API_KEY) {
          try {
            console.log(`  -> AI Processing for ${product.name}...`);
            await processProductAI(product.id);
            // 2-second delay to be safe with SiliconFlow free tier
            await new Promise(r => setTimeout(r, 2000));
          } catch (aiErr) {
            console.error(`  !! AI Processing failed for ${product.name}:`, aiErr.message);
          }
        }
        
      } catch (error) {
        console.error(`❌ Error inserting product ${productData.product_name}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n📊 Insertion completed:`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`📦 Total: ${products.length}`);
    
  } catch (error) {
    console.error('Error reading JSON file:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the insertion
insertProducts().catch(console.error);