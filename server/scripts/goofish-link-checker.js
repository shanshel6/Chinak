import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';
import readline from 'readline';

console.log('[DEBUG] goofish-link-checker.js: File loaded fresh from rebuild.');

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

const prisma = new PrismaClient();
const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || 'sk-kmdgyfekpzcvsxnqfjncohtdzrtgtoxbfgiyuhwsocgilrso').trim();

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

// Simple SiliconFlow client using axios
async function callSiliconFlow(messages, temperature = 0.3, maxTokens = 500) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
      model: "Qwen/Qwen3-8B",
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      enable_thinking: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 30000
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('SiliconFlow API Error:', error.message);
    if (error.response) {
        console.error('Response data:', error.response.data);
    }
    return null;
  }
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function checkGoofishLinks() {
  console.log('Starting Goofish link checker & image updater...');
  if (SILICONFLOW_API_KEY) {
      console.log('AI Translation Enabled. API Key present (ends with):', SILICONFLOW_API_KEY.slice(-4));
  } else {
      console.warn('AI Translation DISABLED. No API Key found.');
  }

  const startInput = await askQuestion('Start from Product ID (press Enter for beginning): ');
  const startId = startInput ? parseInt(startInput.trim(), 10) : 0;

  console.log(`Starting check from Product ID: ${startId || 'Beginning'}`);

  const goofishWhere = {
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
  };

  if (startId > 0) {
    goofishWhere.id = { gte: startId };
  }

  const totalProducts = await prisma.product.count({ where: goofishWhere });
  
  if (totalProducts === 0) {
    console.log('No products found to check.');
    await prisma.$disconnect();
    return;
  }

  // 1. Get active Goofish/Xianyu products starting from startId
  const products = await prisma.product.findMany({
    where: goofishWhere,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      purchaseUrl: true,
      imagesChecked: true,
      specs: true
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

  if (!executablePath) {
    console.error('Chrome/Edge executable not found on system.');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--incognito'
    ]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  
  // Randomize Viewport slightly
  const width = 1920 + Math.floor(Math.random() * 100) - 50;
  const height = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width, height });

  // Rotate User Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1'
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = { runtime: {} };
  });

  console.log('Browser launched. Processing products...');

  let processedCount = 0;
  let updatedCount = 0;
  let unavailableCount = 0;

  try {
    for (const product of products) {
      processedCount++;
      console.log(`\n[${processedCount}/${totalProducts}] Checking Product ID ${product.id}: ${product.name},`);
      console.log(`URL: \`${product.purchaseUrl}\``);

      if (!product.purchaseUrl) {
        console.log(`⚠️ No purchase URL for Product ${product.id}. Skipping.`);
        continue;
      }

      try {
        await page.goto(product.purchaseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Random delay to mimic human behavior
        const delay = Math.floor(Math.random() * 1500) + 1000;
        await new Promise(r => setTimeout(r, delay));

        // Check for unavailability keywords
        const pageContent = await page.evaluate(() => document.body.innerText);
        const title = await page.title();
        
        let isUnavailable = false;
        let unavailableReason = '';

        for (const keyword of UNAVAILABLE_KEYWORDS) {
          if (pageContent.includes(keyword) || title.includes(keyword)) {
            isUnavailable = true;
            unavailableReason = keyword;
            break;
          }
        }

        // Also check if redirected to login or error page (simple check)
        if (page.url().includes('login.taobao.com') || page.url().includes('login.tmall.com')) {
           // Login required isn't necessarily unavailable, but we can't check it.
           // For now, let's log a warning and skip updating status.
           console.warn('⚠️ Redirected to login page. Cannot verify status accurately. Skipping.');
           continue;
        }

        if (isUnavailable) {
          console.log(`❌ Product ${product.id} is UNAVAILABLE. Reason: Found keyword: ${unavailableReason}`);
          
          await prisma.product.update({
            where: { id: product.id },
            data: { isActive: false }
          });
          unavailableCount++;
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
            
            const rawSpecsText = JSON.stringify(rawSpecs);
            // Relaxed check: always try to translate if key exists, or assume Chinese if unsure
            // const containsChinese = /[\u4e00-\u9fff]/.test(rawSpecsText);
            const containsChinese = true; // FORCE translation attempt for now to debug

            // Debug log to confirm flow
            console.log(`[DEBUG] Product ${product.id} - API Key Present: ${!!SILICONFLOW_API_KEY}, Contains Chinese: ${containsChinese}`);

            if (SILICONFLOW_API_KEY) {
                  console.log(`ℹ️ Product ${product.id} specs found. Attempting translation...`);
                  try {
                    const prompt = `Translate this JSON from Chinese to Arabic. Translate keys and values. Return JSON only.\n${JSON.stringify(rawSpecs)}`;
                    
                    // Increased tokens slightly
                    const translatedJsonStr = await callSiliconFlow([{ role: "user", content: prompt }], 0.2, 350);
                    
                    if (translatedJsonStr) {
                      const cleanJson = translatedJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                      let translatedSpecs;
                      try {
                        translatedSpecs = JSON.parse(cleanJson);
                      } catch (parseErr) {
                         console.error(`❌ Failed to parse translated specs JSON for Product ${product.id}:`, parseErr.message);
                         translatedSpecs = rawSpecs;
                      }
                      
                      console.log(`✅ Translated specs for Product ${product.id}:`, JSON.stringify(translatedSpecs));
                      
                      await prisma.product.update({
                        where: { id: product.id },
                        data: { specs: JSON.stringify(translatedSpecs) }
                      });
                    } else {
                        console.warn(`⚠️ Translation returned empty for Product ${product.id}. Saving raw specs.`);
                        await prisma.product.update({
                            where: { id: product.id },
                            data: { specs: rawSpecsText }
                        });
                    }
                  } catch (err) {
                    console.error(`❌ Failed to translate specs for Product ${product.id}:`, err.message);
                    await prisma.product.update({
                        where: { id: product.id },
                        data: { specs: rawSpecsText }
                    });
                  }
            } else {
              console.warn(`⚠️ SILICONFLOW_API_KEY missing. Saving raw specs for Product ${product.id}.`);
              await prisma.product.update({
                where: { id: product.id },
                data: { specs: rawSpecsText }
              });
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
      console.error(`Error processing Product ${product.id}:`, error.message);
    }
  }
  } catch (err) {
    console.error('Fatal error during processing:', err);
  } finally {
    console.log('\n--- Summary ---');
    console.log(`Processed: ${processedCount}`);
    console.log(`Unavailable/Removed: ${unavailableCount}`);
    console.log(`Images Updated: ${updatedCount}`);
    
    await browser.close();
    await prisma.$disconnect();
    console.log('Done.');
    process.exit(0);
  }
}

checkGoofishLinks().catch(console.error);
