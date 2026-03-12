import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

const prisma = new PrismaClient();
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY;

// Indicators that a product is gone
const UNAVAILABLE_KEYWORDS = [
  '卖掉了', // Sold out (Primary indicator)
  '宝贝不存在', // Baby does not exist
  '下架', // Taken off shelf
  '删除', // Deleted
  '转移', // Transferred
  '很抱歉', // Very sorry
  'Sold out',
  'This item is no longer available',
  '商品已失效' // Product invalid
];

// Simple DeepInfra client using axios
async function callDeepInfra(messages, temperature = 0.3, maxTokens = 500) {
  if (!DEEPINFRA_API_KEY) return null;
  try {
    const response = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', {
      model: "google/gemma-3-12b-it",
      messages,
      temperature,
      max_tokens: maxTokens
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPINFRA_API_KEY}`
      },
      timeout: 30000
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('DeepInfra API Error:', error.message);
    return null;
  }
}

async function checkGoofishLinks() {
  console.log('Starting Goofish link checker & image updater...');

  // 1. Get all active Goofish/Xianyu products (excluding Taobao)
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: [
        {
          OR: [
            { purchaseUrl: { contains: 'goofish.com' } },
            { purchaseUrl: { contains: 'xianyu.com' } }
          ]
        },
        {
          NOT: { purchaseUrl: { contains: 'taobao.com' } }
        }
      ]
    },
    select: {
      id: true,
      name: true,
      purchaseUrl: true,
      imagesChecked: true
    }
  });

  console.log(`Found ${products.length} active Goofish/Xianyu products to check.`);

  if (products.length === 0) {
    console.log('No products to check.');
    await prisma.$disconnect();
    return;
  }

  // 2. Launch Browser
  const CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  
  let executablePath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }

  const browser = await puppeteer.launch({
    executablePath: executablePath || undefined,
    headless: false,
    defaultViewport: null,
    args: [
      '--incognito',
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--proxy-server=http://192.168.2.150:7890' // Use the same local proxy as the scraper
    ]
  });

  // Get all pages
  const pages = await browser.pages();
  let page;

  if (pages.length > 0) {
      // Reuse the existing page instead of creating a new one
      // Since we launched with --incognito, this page is already in the incognito context
      page = pages[0];
  } else {
      // Should rare happen, but create one if none exist
      page = await browser.newPage();
  }
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let checkedCount = 0;
  let deactivatedCount = 0;
  let updatedCount = 0;

  // 3. Loop through products
  for (const product of products) {
    if (!product.purchaseUrl) continue;
    
    console.log(`\n[${checkedCount + 1}/${products.length}] Checking Product ID ${product.id}: ${product.name}`);
    console.log(`URL: ${product.purchaseUrl}`);

    try {
      const response = await page.goto(product.purchaseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000)); // Wait for dynamic content

      const pageTitle = await page.title();
      const pageContent = await page.evaluate(() => document.body.innerText);
      const currentUrl = page.url();

      let isUnavailable = false;
      let reason = '';

      // --- CHECK AVAILABILITY ---
      
      // 1. URL Check
      if (currentUrl.includes('error') || (currentUrl.includes('s.taobao.com') && !product.purchaseUrl.includes('s.taobao.com'))) {
        isUnavailable = true;
        reason = 'Redirected to error/search page';
      }

      // 2. Keyword Check
      if (!isUnavailable) {
        // Specific check for the "Sold Out" button text provided by user
        // Target: <div class="buttons--eV76FZ_U "><div class="banned--Uy6Se2D8">卖掉了</div></div>
        const hasSoldOutButton = await page.evaluate(() => {
            // Check specifically for the class 'banned--Uy6Se2D8' with text '卖掉了'
            const bannedElement = document.querySelector('.banned--Uy6Se2D8');
            if (bannedElement && bannedElement.innerText.trim() === '卖掉了') {
                return true;
            }
            
            // Fallback: Check broadly in buttons or similar elements if class changes
            const elements = Array.from(document.querySelectorAll('button, div[role="button"], span, div'));
            return elements.some(el => el.innerText && el.innerText.trim() === '卖掉了');
        });

        if (hasSoldOutButton) {
           isUnavailable = true;
           reason = 'Found "卖掉了" text';
        } else {
          for (const keyword of UNAVAILABLE_KEYWORDS) {
            if (pageTitle.includes(keyword) || pageContent.includes(keyword)) {
              isUnavailable = true;
              reason = `Found keyword: ${keyword}`;
              break;
            }
          }
        }
      }

      // --- ACTION ---
      if (isUnavailable) {
        console.warn(`❌ Product ${product.id} is UNAVAILABLE. Reason: ${reason}`);
        await prisma.product.update({
          where: { id: product.id },
          data: { isActive: false, status: 'ARCHIVED' }
        });
        deactivatedCount++;
      } else {
        console.log(`✅ Product ${product.id} is AVAILABLE.`);

        // --- NEW/USED DETECTION ---
        const newOrOldStatus = await page.evaluate(() => {
          try {
            // 1. Check for specific images indicating status
            const images = Array.from(document.querySelectorAll('img'));
            const newImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN015hOhg21hTpVIveeDA_!!6000000004279-2-tps-252-60.png';
            const usedImgUrl = 'https://gw.alicdn.com/imgextra/i4/O1CN01MQosre1EmUmuzzD3k_!!6000000000394-2-tps-252-60.png';
            const almostNewImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN01yU5CER1wslIj9m7bv_!!6000000006364-2-tps-252-60.png';

            const hasNewImg = images.some(img => img.src === newImgUrl);
            const hasUsedImg = images.some(img => img.src === usedImgUrl);
            const hasAlmostNewImg = images.some(img => img.src === almostNewImgUrl);

            if (hasNewImg) return true; // New
            if (hasUsedImg || hasAlmostNewImg) return false; // Used

            // 2. Check text indicators in labels
            const labels = Array.from(document.querySelectorAll('.item--qI9ENIfp'));
            for (const label of labels) {
              const labelText = label.querySelector('.label--ejJeaTRV')?.innerText || '';
              const valueText = label.querySelector('.value--EyQBSInp')?.innerText || '';
              
              if (labelText.includes('成色')) {
                if (valueText.includes('全新')) return true;
                if (valueText.includes('使用痕迹') || valueText.includes('二手') || valueText.includes('闲置') || valueText.includes('有磨损') || valueText.includes('有划痕')) return false;
              }
            }

            // 3. Check description text for keywords
            const desc = document.querySelector('.desc--GaIUKUQY')?.innerText || '';
            if (desc.includes('全新') && !desc.includes('部分全新') && !desc.includes('99新')) return true;
            if (desc.includes('使用痕迹') || desc.includes('二手') || desc.includes('闲置')) return false;

            return null; // Could not determine
          } catch (e) {
            return null;
          }
        });

        if (newOrOldStatus !== null) {
          console.log(`ℹ️ Product ${product.id} detected as ${newOrOldStatus ? 'NEW' : 'USED'}. Updating...`);
          try {
            await prisma.$executeRaw`
              UPDATE "Product" 
              SET "neworold" = ${newOrOldStatus} 
              WHERE "id" = ${product.id}
            `;
          } catch (updateErr) {
            console.error(`Error updating neworold for Product ${product.id}:`, updateErr.message);
          }
        }

        // --- SPECS EXTRACTION ---
        if (product.specs && product.specs !== 'null') {
          console.log(`ℹ️ Specs already exist for Product ${product.id}. Skipping extraction.`);
        } else {
          const rawSpecs = await page.evaluate(() => {
            try {
              const labels = Array.from(document.querySelectorAll('.labels--ndhPFgp8 .item--qI9ENIfp'));
              const specs = {};
              
              for (const item of labels) {
                // Extract label key: Remove invisible chars, newlines, and colons
                const labelEl = item.querySelector('.label--ejJeaTRV');
                if (!labelEl) continue;
                
                // Get text content recursively but ignore hidden structural divs if possible, 
                // or just clean up the text which is usually split into divs like <div><div>品</div></div><div><div>牌</div></div>
                let key = labelEl.innerText.replace(/[\n\r\s：:]/g, '').trim();
                
                // Extract value
                const valueEl = item.querySelector('.value--EyQBSInp');
                if (!valueEl) continue;
                let value = valueEl.innerText.trim();
                
                if (key && value) {
                  specs[key] = value;
                }
              }
              
              return Object.keys(specs).length > 0 ? specs : null;
            } catch (e) {
              return null;
            }
          });

          if (rawSpecs) {
            console.log(`ℹ️ Found specs for Product ${product.id}:`, JSON.stringify(rawSpecs));
            
            // Translate specs using DeepInfra
            if (DEEPINFRA_API_KEY) {
              try {
                const prompt = `Translate the following product specifications from Chinese to Arabic.
                IMPORTANT: You MUST translate BOTH the JSON keys AND the JSON values into Arabic.
                Return ONLY a valid JSON object.
                Do not include any explanations, markdown, or code blocks.
                Input: ${JSON.stringify(rawSpecs)}`;
                
                const translatedJsonStr = await callDeepInfra([{ role: "user", content: prompt }], 0.2, 500);
                
                if (translatedJsonStr) {
                  // Clean markdown if present
                  const cleanJson = translatedJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                  const translatedSpecs = JSON.parse(cleanJson);
                  
                  console.log(`✅ Translated specs for Product ${product.id}:`, JSON.stringify(translatedSpecs));
                  
                  await prisma.product.update({
                    where: { id: product.id },
                    data: { specs: JSON.stringify(translatedSpecs) }
                  });
                }
              } catch (err) {
                console.error(`❌ Failed to translate specs for Product ${product.id}:`, err.message);
              }
            }
          }
        }

        // --- IMAGE EXTRACTION ---
        if (product.imagesChecked) {
            console.log(`ℹ️ Images already checked for Product ${product.id}. Skipping extraction.`);
        } else {
            console.log('Checking for images...');
            const images = await page.evaluate(() => {
            // Selector provided by user
            const container = document.querySelector('.item-main-window-list--od7DK4Fm');
            if (!container) return [];

            const imgElements = Array.from(container.querySelectorAll('img.fadeInImg--DnykYtf4'));
            return imgElements.map(img => img.getAttribute('src')).filter(src => src);
            });

            if (images.length > 0) {
                // Clean URLs
                const cleanImages = images.map(url => {
                    let clean = url;
                    if (clean.startsWith('//')) clean = 'https:' + clean;
                    // Remove resizing suffix like _220x10000Q90.jpg_.webp to get full size
                    return clean.replace(/_\d+x\d+.*$/, '').replace(/\.webp$/, '');
                });

                // Use the first image as the main image
                const mainImage = cleanImages[0];

                console.log(`Found ${cleanImages.length} images. Updating database...`);

                // Transaction to update product and replace gallery images
                await prisma.$transaction(async (tx) => {
                    // 1. Update main product image and mark imagesChecked as true
                    await tx.product.update({
                        where: { id: product.id },
                        data: { 
                            image: mainImage,
                            imagesChecked: true
                        }
                    });

                    // 2. Delete existing gallery images to avoid duplicates
                    await tx.productImage.deleteMany({
                        where: { productId: product.id }
                    });

                    // 3. Insert new gallery images
                    if (cleanImages.length > 0) {
                        await tx.productImage.createMany({
                            data: cleanImages.map((url, index) => ({
                                productId: product.id,
                                url: url,
                                order: index,
                                type: 'GALLERY'
                            }))
                        });
                    }
                }, {
                    maxWait: 5000, // default: 2000
                    timeout: 10000 // default: 5000
                });
                updatedCount++;
                console.log(`Images updated for Product ${product.id}`);
            } else {
                console.log('No images found with the specified selector.');
                // Mark checked even if no images found to avoid re-checking empty ones repeatedly?
                // For now, let's only mark if we actually found something, or maybe we should mark it anyway?
                // User said "mark that product so you won't add imgs again", implying we should mark it as processed.
                
                await prisma.product.update({
                    where: { id: product.id },
                    data: { imagesChecked: true }
                });
                console.log(`Marked Product ${product.id} as checked (no images found).`);
            }
        }
      }

    } catch (error) {
      console.error(`Error processing product ${product.id}:`, error.message);
      if (error.message.includes('404')) {
         console.warn(`❌ Product ${product.id} returned 404. Deactivating.`);
         await prisma.product.update({
          where: { id: product.id },
          data: { isActive: false, status: 'ARCHIVED' }
        });
        deactivatedCount++;
      }
    }

    checkedCount++;
    // Delay to avoid blocking
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n------------------------------------------------');
  console.log(`Finished checking ${checkedCount} products.`);
  console.log(`Deactivated: ${deactivatedCount}`);
  console.log(`Updated Images: ${updatedCount}`);

  await browser.close();
  await prisma.$disconnect();
}

checkGoofishLinks().catch(async (e) => {
  console.error('Fatal Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
