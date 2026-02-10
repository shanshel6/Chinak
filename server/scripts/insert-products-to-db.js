import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            chineseName: productData.product_name, // You might want to extract Chinese name separately
            description: JSON.stringify(productData.product_details),
            price: parseFloat(productData.general_price) || 0,
            basePriceRMB: parseFloat(productData.general_price) || 0,
            image: productData.main_images[0] || '',
            purchaseUrl: productData.url,
            weight: parseFloat(productData.weight) || null,
            domesticShippingFee: parseFloat(productData.domestic_shipping_fee) || 0,
            minOrder: parseInt(productData.min_order || productData.minOrder) || 1,
            deliveryTime: productData.delivery_time || productData.deliveryTime || productData.Delivery_time || null,
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
                  weight: parseFloat(productData.weight) || null
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