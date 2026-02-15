import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai'; // Use OpenAI SDK for SiliconFlow
import readline from 'readline';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env'); // server/.env
dotenv.config({ path: envPath });
const prisma = new PrismaClient();
// const prisma = { $disconnect: async () => {} };

// Initialize AI (DeepInfra)
let aiClient = null;

let AI_MODEL = "meta-llama/Llama-4-Scout-17B-16E-Instruct"; // Reverted to Llama-4-Scout

if (process.env.DEEPINFRA_API_KEY) {
    aiClient = new OpenAI({
        baseURL: "https://api.deepinfra.com/v1/openai",
        apiKey: process.env.DEEPINFRA_API_KEY,
    });
    console.log(`AI Initialized (DeepInfra: ${AI_MODEL})`);
} else if (process.env.SILICONFLOW_API_KEY) {
    // Fallback to SiliconFlow if DeepInfra not set (backward compatibility)
    aiClient = new OpenAI({
        baseURL: "https://api.siliconflow.cn/v1",
        apiKey: process.env.SILICONFLOW_API_KEY,
    });
    console.log('AI Initialized (SiliconFlow)');
} else {
    console.log('Warning: No AI API KEY found. AI features will use mock data.');
}


// --- Configuration ---
// Allow URL to be passed via command line argument
const cliUrl = process.argv[2];
let CATEGORY_URL = cliUrl && cliUrl.startsWith('http') 
    ? cliUrl 
    : 'https://mobile.pinduoduo.com/search_result.html?search_key=%E5%8D%95%E8%82%A9%E5%8C%85%E5%A5%B3&search_type=goods&source=index&options=3&paste=1&search_met_track=manual&refer_page_el_sn=99885&refer_page_name=search_result&refer_page_id=10015_1771136715200_6j6plj2ual&refer_page_sn=10015&page_id=10015_1771136725342_6mr9yzf00z&bsch_is_search_mall=&bsch_show_active_page=&flip=0%3B0%3B0%3B0%3B630af7c3-043b-2964-39b0-12664add80c2%3B%2F20%3B0%3B0%3B47270af4a8bda0d0d524441a2e99ac18&sort_type=default&price_index=0&price=0%2C25&filter=price%2C0%2C25&opt_tag_name=&brand_tab_filter=&item_index=1'; 

if (cliUrl) {
    console.log('Using URL from command line:', cliUrl);
} else {
    console.log('Using default/hardcoded URL.');
}

const TARGET_PRODUCT_COUNT = 999999; // Effectively infinite
const OUTPUT_FILE = path.join(__dirname, '..', 'pinduoduo-products.json'); 
const PAGE_LOAD_TIMEOUT = 60000;

// Global flag for graceful shutdown
let isRunning = true;
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Stopping scraper gracefully...');
    isRunning = false;
});

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Helper: Process with AI
async function enrichWithAI(title, description, price) {
    if (!aiClient) {
        return {
            translatedTitle: title + " (Translation Pending)",
            translatedDesc: description + " (Translation Pending)",
            aiMetadata: {
                synonyms: ["Placeholder"],
                market_tags: ["Tag"],
                category_suggestion: "General"
            }
        };
    }

    try {
        const prompt = `
        You are a product data enrichment assistant for an Iraqi e-commerce site.
        
        Original Product Title (Chinese): "${title}"
        Product Description: "${description}"
        Price: "${price}"

        Task:
        1. Extract the Brand Name in English (e.g., "Nike", "Sony", "Xiaomi"). If no brand is found, ignore it.
        2. Translate the Product Name to ARABIC accurately.
           - TARGET LANGUAGE: ARABIC (Iraq dialect or MSA).
           - INPUT: Chinese -> OUTPUT: Arabic.
           - DO NOT output English (except for the Brand Name).
           - Remove marketing fluff like "hot sale", "new arrival", "2024", "Ready Stock".
           - Example: "冬季加绒卫衣" -> "كنزة شتوية مبطنة" (NOT "Winter Fleece Sweater").
        3. Combine them into "product_name_ar" format: "[Arabic Name]".
           - ONLY include the brand if it is a well-known international brand (e.g. Nike, Adidas, Sony).
           - If the brand is generic, unknown, or "No Brand", DO NOT include it in the title.
           - NEVER include text like "No Brand", "Generic", "Other", "ماركة غير معروفة" in the title.
           - IMPORTANT: You MUST translate the actual title. Do NOT use placeholder text like "اسم المنتج بالعربية".
        4. Extract "product_details_ar" as a structured Key-Value JSON object in ARABIC.
        5. Generate "aiMetadata" based strictly on the product Title and Description.
            - "synonyms": Array of 3-5 alternative Arabic names SPECIFIC to this product (e.g. if it's a hoodie, use "هودي", "سويت شيرت", "بلوفر").
            - "market_tags": Array of 3-5 relevant tags in Arabic derived from the product features (e.g. "قطن", "شتوي", "رياضي").
            - "category_suggestion": A specific category path in Arabic that fits this product (e.g. "ملابس رجالية > سترات").

         CRITICAL INSTRUCTIONS:
         - The "product_name_ar" MUST be in ARABIC script (except the brand).
        - If the original title is "WASSUP BEAVER...", translate "WASSUP BEAVER" as the Brand, and the rest as the Arabic name.
        - NEVER return "اسم غير متوفر" (Name Not Available). ALWAYS generate a descriptive Arabic name based on the description if the title is unclear.
        - Example: If title is "2025 Winter Jacket", output "سترة شتوية 2025".
        - The translation MUST be high quality and natural for Arabic speakers in Iraq.
        - If the product name is vague or generic in Chinese, infer the specific type from description or context.
        - The "product_details_ar" field MUST be a JSON OBJECT (key-value pairs), NOT a string.
        - Example format for details:
          "product_details_ar": { 
              "المادة": "قماش كتّان", 
              "الميزة": "ألوان متعددة", 
              "التصميم": "إبداعي", 
              "الاستخدام": "غرفة المعيشة" 
          }
        - STRICTLY EXCLUDE any "return policy", "refund", "replacement", "shipping", "free shipping", or "guarantee" information from details.
        - STRICTLY EXCLUDE any PRICE or COST information (e.g., "السعر", "Price", "29.9 ريال") from details.
        - DO NOT include keys with EMPTY values (e.g. "الماركة": "" should be removed).
        - Do NOT include any Chinese characters (like ¥, 包邮, 品牌, etc.) in values.
        - English text IS ALLOWED for Brand Names and Model Numbers.
        - Convert all prices and measurements to Arabic format if possible.

        Return ONLY a valid JSON object with this structure (no markdown):
        {
            "product_name_ar": "Put Translated Name Here",
            "product_details_ar": {
                "الماركة": "قيمة",
                "اللون": "قيمة",
                "المادة": "قيمة"
            },
            "aiMetadata": {
                "synonyms": ["مرادف1", "مرادف2"],
                "market_tags": ["تاق1", "تاق2"],
                "category_suggestion": "اسم التصنيف"
            }
        }
        `;

        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts) {
            try {
                const responsePromise = aiClient.chat.completions.create({
                    model: AI_MODEL, // Use defined model
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1024,
                });

                const response = await Promise.race([
                    responsePromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('AI Request Timeout')), 25000))
                ]);

                let text = response.choices[0].message.content;
                text = text.replace(/```json/g, '').replace(/```/g, '').trim();
                
                // Attempt to fix common JSON syntax errors from AI
                // 1. Remove trailing commas in objects/arrays: ,} -> } or ,] -> ]
                text = text.replace(/,(\s*[}\]])/g, '$1');
                
                const jsonStart = text.indexOf('{');
                let parsed = null;

                if (jsonStart !== -1) {
                    let endSearchPos = text.lastIndexOf('}');
                    while (endSearchPos > jsonStart) {
                        try {
                            const candidate = text.substring(jsonStart, endSearchPos + 1);
                            parsed = JSON.parse(candidate);
                            break;
                        } catch (e) {
                            endSearchPos = text.lastIndexOf('}', endSearchPos - 1);
                        }
                    }
                }

                if (!parsed) {
                    console.error("Failed to parse AI response. Raw text:", text);
                    throw new Error("JSON parsing failed after multiple attempts.");
                }

                // CHECK FOR INVALID/PLACEHOLDER NAMES
                if (parsed.product_name_ar) {
                     const badNames = [
                         'اسم غير متوفر',
                         'name not available',
                         'اسم المنتج بالعربيه',
                         'اسم المنتج بالعربية',
                         'put translated name here',
                         'arabic name',
                         'ترجمة اسم المنتج'
                     ];
                     const lowerName = parsed.product_name_ar.toLowerCase();
                     
                     // Check if name matches any bad pattern or contains Chinese
                     if (badNames.some(bad => lowerName.includes(bad)) || /[\u4e00-\u9fa5]/.test(parsed.product_name_ar)) {
                         console.log(`AI returned invalid name: "${parsed.product_name_ar}". Retrying...`);
                         throw new Error('AI returned invalid name (placeholder or Chinese)');
                     }
                } else {
                    throw new Error('AI returned empty product_name_ar');
                }

                try {
                    const stripChinese = (str) => {
                        if (typeof str !== 'string') return str;
                        // Don't strip immediately, let's keep it for now or refine logic
                        // Only strip if it's mixed, but for Arabic name we want PURE Arabic.
                        // However, if AI returns "Brand (English) + Arabic", that's fine.
                        return str.trim(); 
                    };

                    // if (parsed.product_name_ar) { ... } // Removed redundant check block since we did it above

                    if (parsed.product_details_ar) {
                        for (const key in parsed.product_details_ar) {
                            // Strip Chinese
                            parsed.product_details_ar[key] = stripChinese(parsed.product_details_ar[key]);
                            
                            // Check if value still has Chinese characters
                            if (/[\u4e00-\u9fa5]/.test(parsed.product_details_ar[key])) {
                                delete parsed.product_details_ar[key]; // Remove key if translation failed
                            }

                            // Remove empty keys
                            if (!parsed.product_details_ar[key] || parsed.product_details_ar[key].trim() === '') {
                                delete parsed.product_details_ar[key];
                            }
                        }
                    }

                    if (parsed.aiMetadata) {
                         // Ensure arrays are arrays
                         if (!Array.isArray(parsed.aiMetadata.synonyms)) parsed.aiMetadata.synonyms = [];
                         if (!Array.isArray(parsed.aiMetadata.market_tags)) parsed.aiMetadata.market_tags = [];
                         if (!parsed.aiMetadata.category_suggestion) parsed.aiMetadata.category_suggestion = "عام";
                    } else {
                        // Fallback: Try to infer from parsed name if possible, otherwise use generic but marked as fallback
                         parsed.aiMetadata = {
                             synonyms: [parsed.product_name_ar], // Use the name itself as a synonym at least
                             market_tags: ["منتج مميز"],
                             category_suggestion: "أخرى"
                         };
                    }

                    return parsed;
                } catch (jsonError) {
                    throw jsonError; 
                }
            } catch (e) {
                attempts++;
                console.error(`AI Error (Attempt ${attempts}/${maxAttempts}):`, e.message);
                if (e.message.includes('429')) {
                    const waitTime = attempts * 5000;
                    console.log(`Rate limit hit. Waiting ${waitTime/1000}s...`);
                    await delay(waitTime);
                } else {
                    await delay(2000);
                }
            }
        }
        throw new Error("Max AI attempts reached");
    } catch (e) {
        console.error("AI Generation Error:", e.message);
        // CRITICAL CHANGE: If all attempts failed or returned bad names, SKIP this product.
        // Return a special flag to the caller.
        return {
            shouldSkip: true,
            reason: "AI Translation Failed (Max Attempts)"
        };
    }
}

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

function getExecutablePath() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const delay = (ms) => new Promise(resolve => {
    const end = Date.now() + ms;
    const timer = setInterval(() => {
        if (Date.now() >= end) {
            clearInterval(timer);
            resolve();
        }
    }, 100);
});
const humanDelay = (min = 1000, max = 3000) => delay(Math.floor(Math.random() * (max - min + 1)) + min);

async function createBrowser() {
  const executablePath = getExecutablePath();
  if (!executablePath) {
    console.error('Chrome/Edge executable not found.');
    process.exit(1);
  }

  return await puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    userDataDir: 'chrome_data_pdd_fresh_v34',
    args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certifcate-errors',
        '--ignore-certifcate-errors-spki-list',
        '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= 600) { 
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

async function run() {
    console.log('[Start] Initializing Pinduoduo Scraper (Click-and-Scrape Mode)...');
    
    // Ask for URL or use predefined
    console.log('----------------------------------------------------');
    let urlInput = '';
    
    // Check if CATEGORY_URL is already set in the code (length > 10)
    if (CATEGORY_URL && CATEGORY_URL.length > 10) {
        urlInput = CATEGORY_URL;
        console.log('Using predefined CATEGORY_URL from script.');
    } else if (process.argv[2]) {
        urlInput = process.argv[2];
    } else {
        urlInput = await askQuestion('Enter the Pinduoduo Category URL to scrape: ');
    }

    urlInput = urlInput.trim();
    if (!urlInput.startsWith('http')) {
        console.error('❌ Error: Invalid URL provided. The URL must start with "http" or "https".');
        console.error('You entered:', urlInput);
        console.log('Please restart the script and paste the correct URL.');
        process.exit(1);
    }
    
    // const urlInput = "https://mobile.pinduoduo.com/catgoods.html?refer_page_name=index&opt_id=25667&opt_name=%E4%B8%8A%E8%A1%A3%E5%A4%96%E5%A5%97&opt_type=2&goods_id=836596630021&refer_page_id=10002_1770945474906_zhvvkggy6l&refer_page_sn=10002";
    console.log('Using URL:', urlInput);
    console.log('----------------------------------------------------');
    CATEGORY_URL = urlInput.trim();

    let browser = await createBrowser();
    console.log('Browser launched');
    let page = await browser.newPage();
    console.log('Page created');
    
    // --- STEALTH MEASURES ---
    
    // 1. Set Mobile Viewport (iPhone 13 size)
    // Matches the User Agent we set in launch args
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    
    // 2. Override Navigator Properties to mimic iPhone
    await page.evaluateOnNewDocument(() => {
        // Mask WebDriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Mock Platform
        Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
        
        // Mock Max Touch Points
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
        
        // Mock Languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        // Mock Plugins (Empty array for iOS)
        Object.defineProperty(navigator, 'plugins', { get: () => [] }); 
    });

    // 4. Visit Home Page for Login
    const HOME_URL = 'https://mobile.pinduoduo.com/';
    console.log('Visiting Home URL for Login:', HOME_URL);
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    console.log('Goto done');

    console.log('================================================================');
    console.log('  PAUSING FOR MANUAL LOGIN (5 seconds)');
    console.log('  Please log in manually now if needed.');
    console.log('================================================================');
    console.log('Starting delay...');
    await delay(5000); 
    console.log('Delay finished. Resuming...');

    // 2. Visit Category Page
    console.log('Visiting Category URL:', CATEGORY_URL);
    await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

    // --- SCROLL PAST HEADER ---
    console.log('Scrolling down to bypass header/category icons...');
    
    // Scroll down one full screen height + a bit more
    await page.evaluate(async () => {
        const viewportHeight = window.innerHeight;
        window.scrollBy(0, viewportHeight + 200);
        await new Promise(r => setTimeout(r, 1000));
    });
    
    await humanDelay(2000, 3000);

    // 3. Click and Scrape Loop
    console.log('[Phase 1] Starting Click-and-Scrape Loop...');
    
    // STRATEGY CHANGE: Blind Click in Center-Right
    // Since element detection is being blocked or misled by PDD's anti-bot structure,
    // we will simulate a human tapping on a likely product location.
    // On mobile view (375x667 approx), products are usually in a 2-column grid.
    // A tap at roughly (75% width, 50% height) should hit the right-side product.
    
    let products = [];
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            products = JSON.parse(fs.readFileSync(OUTPUT_FILE));
        }
    } catch(e) {}
    
    // Main Loop
    // User requested infinite loop until manually stopped
    while (isRunning) {

        // --- VALIDATE CURRENT URL ---
        // Ensure we are still on the category page or search result page we started with.
        // If we drifted to home or another category, go back.
        const currentUrlBeforeScroll = page.url();
        const isHomePage = currentUrlBeforeScroll === 'https://mobile.pinduoduo.com/' || currentUrlBeforeScroll.includes('page_id=10002');
        // Simple check: if we are not on the category URL and not on a product page (which we shouldn't be here), go back.
        // Better: Check if the URL contains key parts of our CATEGORY_URL
        // Extract 'search_key' from CATEGORY_URL if it exists
        let requiredParam = '';
        try {
            const catUrlObj = new URL(CATEGORY_URL);
            if (catUrlObj.searchParams.has('search_key')) {
                requiredParam = 'search_key=' + encodeURIComponent(catUrlObj.searchParams.get('search_key'));
            } else if (catUrlObj.searchParams.has('cat_id')) {
                requiredParam = 'cat_id=' + catUrlObj.searchParams.get('cat_id');
            }
        } catch(e) {}

        if (isHomePage || (requiredParam && !currentUrlBeforeScroll.includes(decodeURIComponent(requiredParam)) && !currentUrlBeforeScroll.includes(requiredParam))) {
             console.log('WARNING: Drifted away from category page. Redirecting back to:', CATEGORY_URL);
             await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
             await humanDelay(3000, 5000);
        }

        
        // --- 4-POINT BLIND CLICK STRATEGY ---
        console.log('Scrolling down to find new batch of products...');
        
        // 1. Scroll down one screen size + a bit
        await page.evaluate(async () => {
            const viewportHeight = window.innerHeight;
            window.scrollBy(0, viewportHeight + 200);
            await new Promise(r => setTimeout(r, 1000));
        });
        
        await humanDelay(2000, 3000);

        // Define the 4 click points (percentages of viewport)
        // Top-Right: 75% width, 30% height
        // Top-Left:  25% width, 30% height
        // Bot-Left:  25% width, 70% height
        // Bot-Right: 75% width, 70% height
        // We add randomization to each.
        
        const clickPoints = [
            { name: "Top-Right", xPct: 0.75, yPct: 0.30 },
            { name: "Top-Left",  xPct: 0.25, yPct: 0.30 },
            { name: "Bot-Left",  xPct: 0.25, yPct: 0.70 },
            { name: "Bot-Right", xPct: 0.75, yPct: 0.70 }
        ];

        for (const point of clickPoints) {
            if (!isRunning) break;
            // if (products.length >= TARGET_PRODUCT_COUNT) break; // Removed limit as per request

            console.log(`Preparing to click: ${point.name}...`);

            const clickCoordinates = await page.evaluate((pt) => {
                 const width = window.innerWidth;
                 const height = window.innerHeight;
                 
                 // Add randomization (+/- 15px)
                 const randomX = Math.floor(Math.random() * 30) - 15; 
                 const randomY = Math.floor(Math.random() * 30) - 15; 
                 
                 return {
                     x: Math.floor(width * pt.xPct) + randomX,
                     y: Math.floor(height * pt.yPct) + randomY
                 };
            }, point);
            
            console.log(`Clicking at (${clickCoordinates.x}, ${clickCoordinates.y})...`);
            
            // Listen for new target
            const newTargetPromise = new Promise(resolve => browser.once('targetcreated', resolve));
            const currentUrl = page.url();

            try {
                await page.mouse.click(clickCoordinates.x, clickCoordinates.y);
            } catch (e) {
                console.log('Click failed:', e.message);
            }

            // Wait for navigation
            let newPage = null;
            let navigationHappened = false;

            try {
                const target = await Promise.race([
                    newTargetPromise,
                    delay(3000).then(() => null)
                ]);

                if (target && target.type() === 'page') {
                    console.log('New tab detected.');
                    newPage = await target.page();
                } else {
                    console.log('No new tab. Checking if current page navigated...');
                    await delay(2000); 
                    if (page.url() !== currentUrl && !page.url().includes('catgoods')) {
                        console.log('Current page navigated. Treating as product page.');
                        newPage = page;
                        navigationHappened = true;
                    } else {
                         console.log('Click did not trigger navigation. Moving to next point.');
                         // Just continue to next point in loop
                         continue; 
                    }
                }
            } catch (e) {
                console.log('Target detection error:', e.message);
                continue;
            }

            if (!newPage) continue;

            // --- SCRAPE PRODUCT PAGE ---
            try {
                await newPage.waitForLoadState ? newPage.waitForLoadState('domcontentloaded') : newPage.waitForSelector('body', { timeout: 15000 });
                await humanDelay(2000, 4000);

                const productUrl = newPage.url();
                console.log(`Scraping Product URL: ${productUrl}`);

                // --- ROBUST DEDUPLICATION ---
                try {
                    const urlObj = new URL(productUrl);
                    const goodsId = urlObj.searchParams.get('goods_id');
                    
                    if (goodsId) {
                        // 1. Check if already in current session (in-memory)
                        const alreadyScrapedInSession = products.some(p => p.url && p.url.includes(goodsId));
                        if (alreadyScrapedInSession) {
                            console.log(`Product already scraped in THIS SESSION. Skipping: ${goodsId}`);
                            if (!navigationHappened) await newPage.close();
                            else await newPage.goBack();
                            continue; 
                        }

                        // 2. Check Database
                        const existingProduct = await prisma.product.findFirst({
                            where: {
                                purchaseUrl: {
                                    contains: goodsId
                                }
                            }
                        });

                        if (existingProduct) {
                             console.log(`Product already in DB (ID: ${existingProduct.id}). Skipping: ${goodsId}`);
                             if (!navigationHappened) await newPage.close();
                             else await newPage.goBack();
                             continue; 
                        }
                    }
                } catch (dbCheckError) {
                    console.error('Error checking DB for duplicate:', dbCheckError.message);
                }

                // Deduplicate by URL (Fallback)
                if (products.some(p => p.url === productUrl)) {
                    console.log('Duplicate product URL. Skipping.');
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack(); 
                    continue;
                }

                // --- WAIT FOR PAGE LOAD ---
                // Ensure the page is fully loaded before scraping
                try {
                    await newPage.waitForLoadState ? newPage.waitForLoadState('domcontentloaded') : newPage.waitForSelector('body', { timeout: 15000 });
                    await humanDelay(2000, 4000);
                } catch (e) {
                    console.log('Page load timeout, attempting scrape anyway...');
                }

                /*
                // --- RANDOM MOVES ON PRODUCT PAGE (Anti-Detection) ---
                console.log('Performing random moves on product page...');
                try {
                     await newPage.evaluate(async () => {
                         const wait = (ms) => new Promise(r => setTimeout(r, ms));
                         const height = document.body.scrollHeight;
                         
                         // Scroll down a bit
                         window.scrollBy(0, 300 + Math.random() * 200);
                         await wait(1000 + Math.random() * 1000);
                         
                         // Scroll up a bit
                         window.scrollBy(0, -100);
                         await wait(500 + Math.random() * 500);
                         
                         // Maybe scroll to bottom
                         if (Math.random() > 0.5) {
                             window.scrollTo(0, height * 0.7);
                             await wait(1000);
                         }
                     });
                     
                     // Stay on page for 5-10 seconds
                     const stayTime = 5000 + Math.random() * 5000;
                     console.log(`Staying on product page for ${(stayTime/1000).toFixed(1)}s...`);
                     await delay(stayTime);
                } catch(e) {
                    console.log('Random moves failed:', e.message);
                }
                */

                const data = await newPage.evaluate(async () => {
                    const wait = (ms) => new Promise(r => setTimeout(r, ms));
                    
                    // HELPER: Strict Price Extraction from User Target
                    const getTargetPrice = () => {
                         const targetDiv = document.querySelector('.ujEqGzEB');
                         if (targetDiv) {
                             // Try aria-label first (e.g. "首件¥29.88")
                             const imgSpan = targetDiv.querySelector('span[role="img"]');
                             if (imgSpan && imgSpan.getAttribute('aria-label')) {
                                 const label = imgSpan.getAttribute('aria-label');
                                 const match = label.match(/¥\s*(\d+(\.\d+)?)/);
                                 if (match) return '¥' + match[1];
                             }
                             // Fallback to text content
                             const text = targetDiv.innerText;
                             const match = text.match(/¥\s*(\d+(\.\d+)?)/);
                             if (match) return match[0];
                         }
                         return null;
                    };

                    // 1. Title Extraction (User specific selector)
                    let title = '';
                    const titleEl = document.querySelector('.tLYIg_Ju span') || 
                                   document.querySelector('.KlGVpw3u span') ||
                                   document.querySelector('.goods-name');
                    if (titleEl) title = titleEl.innerText.trim();
                    if (!title) title = document.title;

                    // 2. Price Extraction (Initial fallback)
                     let price = getTargetPrice();
                     const priceEl = document.querySelector('.goods-price, [class*="price-info"], [class*="goods-price"]');
                     if (!price && priceEl) {
                          price = priceEl.innerText.trim();
                     }
                     if (!price) {
                         const bodyText = document.body.innerText;
                         const priceMatch = bodyText.match(/¥\s*(\d+(\.\d+)?)/);
                         if (priceMatch) price = priceMatch[0];
                     }
 
                     // 3. Description & Details
                     let description = '';
                     let productDetails = {};
                     
                     // Helper: Expand details if needed (Click "Show All" / 查看全部)
                     const expandDetailsBtn = document.querySelector('.QTo2num4');
                     if (expandDetailsBtn) {
                         try { expandDetailsBtn.click(); await wait(500); } catch(e){}
                     }

                     // Extract key-value details from .jvsKAdEs > .iUUH2sOQ
                     // Structure: .iUUH2sOQ -> .rMnkPxwx (Key) + .KjtdjVU2 (Value)
                     const detailItems = document.querySelectorAll('.iUUH2sOQ');
                     detailItems.forEach(item => {
                         const key = item.querySelector('.rMnkPxwx')?.innerText.trim();
                         const val = item.querySelector('.KjtdjVU2')?.innerText.trim();
                         if (key && val) {
                             productDetails[key] = val;
                             description += `${key}: ${val}\n`; // Append to text description as well
                         }
                     });

                     // Fallback description if details are empty
                     if (!description) {
                         description = document.querySelector('.goods-details, [class*="detail-desc"]')?.innerText.trim() || '';
                     }
                     
                     // 4. Variant & Price Extraction from Modal
                    let variants = {};
                    let skuMap = {}; // Store price for each combination
                    let variantImages = {}; // Map color -> imageUrl
                    let lowestVariantPrice = null; // Track lowest price found in variants

                    try {
                        // STRICT BUTTON SELECTION:
                        // 1. MUST NOT be "Separate Buy" (单独购买) which is usually pink/white
                        // 2. MUST BE "Group Buy" (发起拼单) which is usually red
                        
                        const allButtons = Array.from(document.querySelectorAll('div[role="button"]'));
                        
                        // Find the "Group Buy" button specifically
                        // It usually contains "发起拼单" (Initiate Group Buy) or just "拼单" (Group Buy)
                        // It should NOT contain "单独购买" (Separate Buy)
                        const buyBtn = allButtons.find(el => {
                            const text = el.innerText.trim();
                            return (text.includes('拼单') || text.includes('发起')) && !text.includes('单独');
                        });
                        
                        if (buyBtn) {
                            console.log('Found strict Group Buy button, clicking...');
                            buyBtn.click();
                            await wait(2000); // Wait longer for modal to open
                            
                            // Check if modal exists
                            let modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"]');
                            
                            // Retry mechanism for modal
                            if (!modal) {
                                console.log('Modal not found immediately, waiting...');
                                await wait(1500);
                                modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"]');
                            }

                            if (modal) {
                                // Extract basic variants list first
                                const groups = Array.from(modal.querySelectorAll('.bIhLWVqm'));
                                let specKeys = [];
                                let specValues = [];

                                groups.forEach(group => {
                                    const keyEl = group.querySelector('.sku-specs-key');
                                    const valContainer = group.querySelector('.s1O5M5fO');
                                    
                                    if (keyEl && valContainer) {
                                        const key = keyEl.innerText.trim();
                                        const vals = Array.from(valContainer.querySelectorAll('.F7sZG3xe')) // Get the clickables
                                                         .map(el => ({ 
                                                             text: el.querySelector('span.J109_25J')?.innerText.trim(),
                                                             element: el 
                                                         }))
                                                         .filter(v => v.text);
                                        variants[key] = vals.map(v => v.text);
                                        specKeys.push(key);
                                        specValues.push(vals);
                                    }
                                });
                                
                                if (specValues.length === 0) {
                                    console.error('CRITICAL: Modal opened but no variants found. Structure might have changed.');
                                }

                                // DEEP SKU SCRAPING: Iterate combinations
                               // If we have 2 levels (e.g. Color, Size), iterate all

                               if (specValues.length > 0) {
                                    const [level1, level2] = specValues; // Only handle up to 2 levels for now to avoid complexity
                                    
                                    if (level1) {
                                        for (let i = 0; i < level1.length; i++) {
                                            const v1 = level1[i];
                                            // Click Level 1
                                            try { v1.element.click(); await wait(300); } catch(e){}

                                            // CAPTURE VARIANT IMAGE (Color Thumbnail)
                                            // Strategies:
                                            // 1. Modal Header Image (Standard)
                                            // 2. User Specific Selector (Deeply nested)
                                            // 3. Any image in .O7pEFvHR
                                            // 4. Any image with 'sku' in class
                                            
                                            let variantImg = modal.querySelector('.O7pEFvHR img') || 
                                                               modal.querySelector('img[class*="sku"]');
                                            
                                            // Try User Selector if not found
                                            if (!variantImg) {
                                                variantImg = document.querySelector('#main > div > div.GNrMaxlJ > div.m4HArFRm.sku-plus1 > div > div > div.O7pEFvHR > img');
                                            }

                                            // Try getting image from the clicked element itself (sometimes small thumbnail)
                                            if (!variantImg) {
                                                variantImg = v1.element.querySelector('img');
                                            }

                                            if (variantImg && variantImg.src) {
                                                variantImages[v1.text] = variantImg.src.split('?')[0];
                                            }

                                            if (level2) {
                                                for (let j = 0; j < level2.length; j++) {
                                                    const v2 = level2[j];
                                                    // Click Level 2
                                                    try { v2.element.click(); await wait(300); } catch(e){}
                                                    
                                                    // Capture Price
                                                    let currentPriceStr = getTargetPrice(); // PRIORITY: Use strict selector
                                                    
                                                    if (!currentPriceStr) {
                                                        // Fallback: User-Specific Price Selector (Usually Left side)
                                                        const userPriceSelector = '#main > div > div.GNrMaxlJ > div.m4HArFRm.sku-plus1 > div > div > div.O7pEFvHR > div > div.Ngfn6pTR > div.kYzukoxf';
                                                        const userPriceEl = document.querySelector(userPriceSelector);
                                                        
                                                        if (userPriceEl) {
                                                            const text = userPriceEl.innerText.trim();
                                                            const matches = text.match(/¥?\s*(\d+(\.\d+)?)/g);
                                                            if (matches && matches.length > 0) {
                                                                currentPriceStr = matches[0];
                                                            } else {
                                                                currentPriceStr = text;
                                                            }
                                                        } else {
                                                            // Final Fallback
                                                            currentPriceStr = modal.querySelector('.ujEqGzEB')?.innerText.replace(/\n/g, '').trim();
                                                        }
                                                    }

                                                    const comboKey = `${v1.text}__SEP__${v2.text}`;
                                                    
                                                    if (currentPriceStr) {
                                                        skuMap[comboKey] = currentPriceStr;
                                                        
                                                        // Update lowestVariantPrice
                                                        const pMatch = currentPriceStr.match(/(\d+(\.\d+)?)/);
                                                        if (pMatch) {
                                                            const pVal = parseFloat(pMatch[1]);
                                                            if (lowestVariantPrice === null || pVal < lowestVariantPrice) {
                                                                lowestVariantPrice = pVal;
                                                                price = currentPriceStr; // Update display string to lowest
                                                            }
                                                        }
                                                    }
                                                }
                                            } else {
                                                // Single level
                                                // Capture Price
                                                let currentPriceStr = getTargetPrice(); // PRIORITY: Use strict selector
                                                
                                                if (!currentPriceStr) {
                                                    // Fallback: User-Specific Price Selector (Usually Left side)
                                                    const userPriceSelector = '#main > div > div.GNrMaxlJ > div.m4HArFRm.sku-plus1 > div > div > div.O7pEFvHR > div > div.Ngfn6pTR > div.kYzukoxf';
                                                    const userPriceEl = document.querySelector(userPriceSelector);
                                                    
                                                    if (userPriceEl) {
                                                        const text = userPriceEl.innerText.trim();
                                                        const matches = text.match(/¥?\s*(\d+(\.\d+)?)/g);
                                                        if (matches && matches.length > 0) {
                                                            currentPriceStr = matches[0];
                                                        } else {
                                                            currentPriceStr = text;
                                                        }
                                                    } else {
                                                        // Final Fallback
                                                        currentPriceStr = modal.querySelector('.ujEqGzEB')?.innerText.replace(/\n/g, '').trim();
                                                    }
                                                }

                                                if (currentPriceStr) {
                                                    skuMap[v1.text] = currentPriceStr;
                                                    
                                                    // Update lowestVariantPrice
                                                    const pMatch = currentPriceStr.match(/(\d+(\.\d+)?)/);
                                                    if (pMatch) {
                                                        const pVal = parseFloat(pMatch[1]);
                                                        if (lowestVariantPrice === null || pVal < lowestVariantPrice) {
                                                            lowestVariantPrice = pVal;
                                                            price = currentPriceStr; // Update display string to lowest
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                // Close modal to be safe (click X button)
                                const closeBtn = modal.querySelector('div[role="button"][aria-label="关闭弹窗"]') || modal.querySelector('svg');
                                if (closeBtn) {
                                     // closeBtn.click(); // Optional, we are closing page anyway
                                }
                            } else {
                                console.error('CRITICAL: Buy button clicked but modal did not appear.');
                                // Treat as failure to find valid options
                                throw new Error('Modal did not appear after clicking Group Buy');
                            }
                        } else {
                            console.error('CRITICAL: Group Buy button (拼单) not found. Skipping product.');
                            // Throw error to trigger skip logic in catch block if needed, 
                            // or just let it fall through and result in no variants (which usually means skip or basic data only)
                            // User requested: "ignore this product, skip it and go back"
                            throw new Error('SKIP_PRODUCT: Group Buy button not found');
                        }
                    } catch (e) {
                        console.log('Variant extraction failed:', e.message);
                        if (e.message.includes('SKIP_PRODUCT')) {
                            // Signal to outer loop to skip
                            return { shouldSkip: true, reason: 'No Group Buy Button' };
                        }
                    }

                     // 5. Image Extraction with Slider Logic
                     let images = [];
                     
                     // Helper to capture current visible images
                     const captureImages = () => {
                         // STRICT SLIDER SELECTOR: Only target images within the known slider container classes
                         // .goods-slider, .swiper-slide, or specific top containers
                         // We avoid #main > div img as it is too broad and catches header icons/text
                         const sliderSelectors = [
                             '.goods-slider img',
                             '.swiper-slide img',
                             '.swiper-container img',
                             '.banner-slider img',
                             '#main > div > div:first-child img', // Often the first div is the slider
                             '.slick-slide img'
                         ];
                         
                         const imgs = document.querySelectorAll(sliderSelectors.join(', '));
                         
                         imgs.forEach(img => {
                             if (img.src && img.src.startsWith('http') && img.naturalWidth > 400) {
                                 // Clean the URL
                                 let cleanSrc = img.src.split('?')[0];
                                 
                                 // Filter out video snapshots, avatars, icons, and coupons
                                 if (cleanSrc.includes('video-snapshot') || 
                                     cleanSrc.includes('avatar') || 
                                     cleanSrc.includes('icon') || 
                                     cleanSrc.includes('coupon') || 
                                     cleanSrc.includes('.slim.png')) return;

                                 images.push(cleanSrc);
                             }
                         });
                         
                         // FALLBACK: If strict slider extraction failed (empty), try slightly broader but still top-area
                         if (images.length === 0) {
                             // Get images from the top 50% of the page only
                             const allImgs = document.querySelectorAll('img');
                             allImgs.forEach(img => {
                                 const rect = img.getBoundingClientRect();
                                 if (rect.top < window.innerHeight * 0.6 && img.naturalWidth > 400) {
                                      let cleanSrc = img.src.split('?')[0];
                                      if (cleanSrc.startsWith('http') && 
                                          !cleanSrc.includes('avatar') && 
                                          !cleanSrc.includes('icon') &&
                                          !cleanSrc.includes('coupon')) {
                                          images.push(cleanSrc);
                                      }
                                 }
                             });
                         }
                     };
 
                     // Initial capture
                     captureImages();
 
                     // Attempt to slide right (swipe left gesture) to reveal more images
                     const sliderContainer = document.querySelector('#main > div') || document.body;
                     
                     if (sliderContainer) {
                         for (let i = 0; i < 5; i++) { // Swipe 5 times
                             // Simulate touch swipe left
                             const touchStart = new Touch({ identifier: Date.now(), target: sliderContainer, clientX: 300, clientY: 200 });
                             const touchEnd = new Touch({ identifier: Date.now(), target: sliderContainer, clientX: 50, clientY: 200 });
 
                             sliderContainer.dispatchEvent(new TouchEvent('touchstart', { touches: [touchStart], bubbles: true }));
                             sliderContainer.dispatchEvent(new TouchEvent('touchmove', { touches: [touchEnd], bubbles: true }));
                             sliderContainer.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touchEnd], bubbles: true }));
                             
                             await wait(800); // Wait for animation
                             captureImages();
                         }
                     }

                     // --- MAIN IMAGE FIX: Prioritize Images from Specific Picture Div ---
                     // User Request: "set the first main img is the imgs shows in that the picture div"
                     // This usually refers to the main gallery or a specific container that holds the high-res images
                     
                     // 1. Try to find the specific "Picture Div" (often .goods-slider or .slick-slider)
                     // If we found images in the slider, we should prioritize them.
                     // The `images` array already collects them, but let's make sure they are unique and ordered correctly.
                     
                     images = [...new Set(images)]; // Deduplicate first
                     
                     // If we have slider images, they are already at the top.
                     // But if the user meant the "Details" images (which are sometimes high res), we should be careful.
                     // Usually "Main Image" is the first one in the slider.
                     
                     // Let's verify if there's a specific container the user might be referring to.
                     // Often in Pinduoduo mobile, the main image is in a swiper at the top.
                     // We already target that. 
                     
                     // However, sometimes "other pictures" (like description images) get mixed in if we use broad selectors.
                     // Our `captureImages` is already quite strict.
                     
                     // Let's double check if we can be even stricter for the FIRST image.
                     // Look for the absolute first image in the slider container
                     const firstSliderImg = document.querySelector('.goods-slider img') || 
                                          document.querySelector('.swiper-slide-active img') || 
                                          document.querySelector('.slick-current img') ||
                                          document.querySelector('#main > div > div:first-child img');
                                          
                     if (firstSliderImg && firstSliderImg.src) {
                         const mainSrc = firstSliderImg.src.split('?')[0];
                         // Move this image to the front of the array if it exists
                         images = images.filter(img => img !== mainSrc);
                         images.unshift(mainSrc);
                     } else if (images.length > 0) {
                         // If we couldn't pinpoint the slider element but captured images,
                         // ensure the first one in the captured list stays first.
                         // (Already handled by array order, but good to be explicit)
                     }

 
                     // 6. Description Images Extraction
                     let product_desc_imgs = [];
                     
                     console.log('Starting description image extraction sequence...');

                     // Step A: Close the variant modal explicitly
                     try {
                         // User mentioned: "hit the exit button" (likely the X button)
                         // Selector hints: div[role="button"][aria-label="关闭弹窗"] OR .pD0kR4N1
                         const closeBtn = document.querySelector('div[role="button"][aria-label="关闭弹窗"]') || 
                                          document.querySelector('.pD0kR4N1') ||
                                          document.querySelector('div[role="button"] .pD0kR4N1')?.parentElement;
                         
                         if (closeBtn) {
                             // console.log('Closing variant modal...');
                             closeBtn.click();
                             await wait(1000);
                         } else {
                             // Try clicking the overlay/mask
                             const mask = document.querySelector('.ReactModal__Overlay, [class*="overlay"], [class*="mask"]');
                             if (mask) { 
                                 mask.click(); 
                                 await wait(1000);
                             }
                         }
                     } catch(e) {
                         // console.log('Error closing modal:', e.message);
                     }

                     // Step B: Slow Scroll to trigger lazy loading (Anti-detection & Image Loading)
                     // User: "first you have to slowly scroll down so it won't be detected"
                     const moreProductsDiv = document.querySelector('.mP10ZXCw');
                     
                     // Calculate target position (either more products div or bottom of body)
                     const targetTop = moreProductsDiv ? moreProductsDiv.getBoundingClientRect().top + window.scrollY : document.body.scrollHeight;
                     const startScroll = window.scrollY;
                     const distance = targetTop - startScroll;
                     const steps = 30; // Number of steps
                     const stepSize = distance / steps;
                     
                     // Perform slow scroll
                     for (let i = 0; i < steps; i++) {
                         window.scrollBy(0, stepSize);
                         // Random wait between 100ms and 300ms
                         await wait(100 + Math.random() * 200);
                     }
                     await wait(2000); // Final wait for images to render

                     // Step C: Extract images STRICTLY from specific nested path
                     // User hint: #main > div > div.GNrMaxlJ > div:nth-child(19) > div
                     const descContainer = document.querySelector('#main > div > div.GNrMaxlJ > div:nth-child(19) > div');
                     
                     if (descContainer) {
                         // console.log('Found description container, extracting nested images...');
                         // Re-query children after scroll
                         const nestedDivs = Array.from(descContainer.querySelectorAll('div'));
                         
                         // If we fell back to main container, just get all images directly too
                         const directImages = Array.from(descContainer.querySelectorAll('img'));
                         
                         const processImg = (img) => {
                             let src = img.src || img.dataset.src;
                             if (src && !src.startsWith('data:') && img.naturalWidth > 400) {
                                 // Check for lazy loaded attributes often used in PDD
                                 if (src.includes('blank.gif') || src.includes('loading')) {
                                      if (img.dataset.src) src = img.dataset.src;
                                 }
                                 
                                 // STRICT EXCLUSION: Suggested/Recommended Products
                                 // If the image is inside a link to another product, skip it
                                 if (img.closest('a[href*="goods_id"]')) return;
                                 if (img.closest('.recommend-goods')) return;

                                 if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('video-snapshot') && !src.includes('coupon') && !src.includes('.slim.png')) {
                                      product_desc_imgs.push(src.split('?')[0]);
                                 }
                             }
                         };

                         nestedDivs.forEach(div => {
                             const imgs = div.querySelectorAll('img');
                             imgs.forEach(processImg);
                         });
                         
                         directImages.forEach(processImg);
                     } else {
                         // STRICT FALLBACK: If specific container not found, try to find the "Details" section specifically
                         // Pinduoduo usually has a "Goods Details" or "Graphic Details" header
                         // We look for a container that has many large images and is NOT the slider
                         console.log('Specific container not found, attempting strict fallback...');
                         const potentialContainers = Array.from(document.querySelectorAll('.GNrMaxlJ > div'));
                         // Usually the description is near the bottom, often the last or second to last div
                         // We can also look for a div that contains mostly images
                         
                         for (const div of potentialContainers) {
                             const imgs = div.querySelectorAll('img');
                             if (imgs.length > 2) {
                                 // Check if images are large
                                 let largeImgs = 0;
                                 imgs.forEach(img => { if (img.naturalWidth > 400) largeImgs++; });
                                 if (largeImgs > 2) {
                                     imgs.forEach(img => {
                                         if (img.naturalWidth > 400) {
                                              let src = img.src || img.dataset.src;
                                              if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('video-snapshot') && !src.includes('coupon')) {
                                                  product_desc_imgs.push(src.split('?')[0]);
                                              }
                                         }
                                     });
                                     break; // Found one good container, stop
                                 }
                             }
                         }
                     }

                     return { title, price, description, images: [...new Set(images)], variants, skuMap, productDetails, product_desc_imgs: [...new Set(product_desc_imgs)], variantImages };
                 });

                // Enrich
                console.log(`Enriching: ${data.title.substring(0, 20)}...`);
                
                let general_price = 0;
                if (data.price) {
                     const match = data.price.match(/(\d+(\.\d+)?)/);
                     if (match) general_price = parseFloat(match[1]) * 200; 
                }

                const aiData = await enrichWithAI(data.title, data.description, data.price);

                // CHECK: Did AI fail completely?
                if (aiData.shouldSkip) {
                    console.error(`Skipping product due to AI translation failure: ${aiData.reason}`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                // --- GENERATE OPTIONS FROM SKU MAP (WITH TRANSLATION) ---
                let generated_options = [];
                const optionsMap = new Map(); // Key: "Color_Price", Value: Object
                const variantImages = data.variantImages || {};

                if (data.skuMap && Object.keys(data.skuMap).length > 0) {
                    
                    // Helper to translate color/size via AI if possible, or simple mapping
                    // Since we want strict Arabic, we might need a quick AI pass or just use the aiData logic
                    // For now, let's process the structure first, then maybe translate the labels
                    
                    for (const [key, priceStr] of Object.entries(data.skuMap)) {
                        // key is usually "Color__SEP__Size" or just "Color"
                        let color = key;
                        let size = null;
                        
                        if (key.includes('__SEP__')) {
                            const parts = key.split('__SEP__');
                            color = parts[0];
                            size = parts[1];
                        } else if (key.includes('+')) {
                             // Fallback for backward compatibility or if separator missing (shouldn't happen with new logic)
                             // But wait, if the text itself has +, we shouldn't split on it unless we are sure it's the separator.
                             // With the new __SEP__, we can ignore '+' splitting unless it was the old format.
                             // Since we are running a fresh scrape, we don't need backward compat for in-memory data.
                             // However, if we loaded from file... but the file is overwritten.
                             // Let's stick to __SEP__.
                        }

                        // Parse Price
                        let priceVal = 0;
                        const match = priceStr.match(/(\d+(\.\d+)?)/);
                        if (match) {
                             priceVal = parseFloat(match[1]) * 200; 
                        }

                        // Grouping Key: Color + Price
                        const mapKey = `${color}_${priceVal}`;

                        if (!optionsMap.has(mapKey)) {
                            // Find thumbnail for this color
                            let thumbnail = null;
                            if (variantImages[color]) {
                                thumbnail = variantImages[color];
                            } else {
                                // Fallback: Try to find match if color text is slightly different
                                const matchingKey = Object.keys(variantImages).find(k => k.includes(color) || color.includes(k));
                                if (matchingKey) thumbnail = variantImages[matchingKey];
                            }

                            optionsMap.set(mapKey, {
                                color: color,
                                sizes: [],
                                price: priceVal,
                                thumbnail: thumbnail // Add thumbnail
                            });
                        }

                        if (size) {
                            // Weight Unit Conversion: "160-175斤" -> "80-87.5kg"
                            // Regex for ranges: (\d+)-(\d+)斤
                            // Regex for single: (\d+)斤
                            
                            // Handle Range
                            size = size.replace(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)\s*斤/g, (match, p1, p2, p3) => {
                                const start = parseFloat(p1) / 2;
                                const end = parseFloat(p3) / 2;
                                return `${start}-${end}kg`;
                            });
                            
                            // Handle Single
                            size = size.replace(/(\d+(\.\d+)?)\s*斤/g, (match, p1) => {
                                return `${parseFloat(p1) / 2}kg`;
                            });

                            // Clean extra text (e.g. \n快要断码) BEFORE pushing to optionsMap
                            // This ensures the raw size is cleaner before translation
                            size = size.replace(/\n.*$/, '').trim(); // Remove newline and everything after
                            size = size.replace(/【.*?】/g, '').trim(); // Remove brackets like 【高质量】

                            optionsMap.get(mapKey).sizes.push(size);
                        }
                    }
                    
                    generated_options = Array.from(optionsMap.values());
                    
                    // --- DEDUPLICATION OF OPTIONS ---
                    // Fix duplication issue where same option appears multiple times
                    const uniqueOptionsMap = new Map();
                    generated_options.forEach(opt => {
                        // Create a unique key for the option based on Color and Price
                        // Size is an array, so we don't include it in the key yet, but we merge sizes
                        const optKey = (opt.color || '').trim().toLowerCase();
                        
                        if (!uniqueOptionsMap.has(optKey)) {
                            uniqueOptionsMap.set(optKey, {
                                ...opt,
                                sizes: new Set(opt.sizes || [])
                            });
                        } else {
                            // Merge sizes if option exists
                            const existing = uniqueOptionsMap.get(optKey);
                            if (opt.sizes && Array.isArray(opt.sizes)) {
                                opt.sizes.forEach(s => existing.sizes.add(s));
                            }
                            // Keep the lowest price if prices differ? Or highest? Usually consistent.
                            // If price is 0, update it
                            if (existing.price === 0 && opt.price > 0) {
                                existing.price = opt.price;
                            }
                        }
                    });
                    
                    // Convert Sets back to Arrays and update generated_options
                    generated_options = Array.from(uniqueOptionsMap.values()).map(opt => ({
                        ...opt,
                        sizes: Array.from(opt.sizes)
                    }));

                    // CLEAN COLORS BEFORE TRANSLATION
                    // Iterate through generated_options to clean color names locally first
                    generated_options.forEach(opt => {
                        if (opt.color) {
                             opt.color = opt.color.replace(/\n.*$/, '').replace(/【.*?】/g, '').replace(/\s+/g, ' ').trim();
                        }
                        if (opt.sizes && Array.isArray(opt.sizes)) {
                            opt.sizes = opt.sizes.map(s => s.replace(/\n.*$/, '').replace(/【.*?】/g, '').replace(/\s+/g, ' ').trim());
                        }
                    });
 
                     // --- TRANSLATE OPTIONS IF AI IS AVAILABLE ---
                     if (aiClient && generated_options.length > 0) {
                         console.log(`Translating ${generated_options.length} options via AI...`);
                         
                         let translationSuccess = false;
                         let transAttempts = 0;
                         const maxTransAttempts = 3;

                         while (!translationSuccess && transAttempts < maxTransAttempts) {
                             transAttempts++;
                             try {
                                 // Prepare a bulk translation prompt for options
                                 const optionsText = JSON.stringify(generated_options.map(o => ({ c: o.color, s: o.sizes })));
                                 const transPrompt = `
                                 Translate these product options to Arabic.
                                 Input: ${optionsText}
                                 
                                 IMPORTANT:
                                 - Return ONLY a JSON array. Do not include any conversational text like "Here is the JSON" or markdown code blocks.
                                 - If the input contains "kg" (kilograms), KEEP "kg" in the translation (e.g. "80kg" -> "80kg" or "80 كغم").
                                 - Do NOT convert numbers back to original units.
                                 - Remove any Chinese characters or marketing text like "快要断码", "图片色" (Image Color), "高质量", "建议", "斤".
                                 - "图片色" or "默认" should be translated as "كما في الصورة" (As shown in image) or "اللون الافتراضي" (Default Color).
                                 - Remove any newlines or extra whitespace.
                                 - Return pure, clean Arabic names for colors and sizes.
                                 - TRANSLATE COLORS TO ARABIC (e.g. "Black" -> "أسود", "红色" -> "أحمر").
                                 - TRANSLATE "建议" (Recommended) to "مقترح" or remove it if just a label.
                                 - STRICTLY REMOVE any "return policy", "refund", "replacement" (e.g. "包退", "包换") text from option names.
                                 
                                 Return ONLY a JSON array with translated "c" (color) and "s" (sizes).
                                 Example Input: [{"c":"Red","s":["L","80kg"]}]
                                 Example Output: [{"c":"أحمر","s":["لارج","80 كغم"]}]
                                 Keep the order exactly the same.
                                 `;
                                 
                                 const transRes = await aiClient.chat.completions.create({
                                     model: AI_MODEL,
                                     messages: [{ role: "user", content: transPrompt }],
                                     temperature: 0.3,
                                     max_tokens: 2048
                                 });
                                 
                                 let transJson = transRes.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
                                 
                                 // Attempt to find the first '[' and last ']'
                                 const startIdx = transJson.indexOf('[');
                                 const endIdx = transJson.lastIndexOf(']');
                                 if (startIdx !== -1 && endIdx !== -1) {
                                     transJson = transJson.substring(startIdx, endIdx + 1);
                                 }

                                 // console.log('AI Translation Response (First 100 chars):', transJson.substring(0, 100));
                                 
                                 const transArr = JSON.parse(transJson);
                                 
                                 if (Array.isArray(transArr) && transArr.length === generated_options.length) {
                                    generated_options.forEach((opt, idx) => {
                                        // Apply Strict Trimming to translated values
                                        if (transArr[idx].c) {
                                            opt.color = transArr[idx].c.trim().replace(/\s+/g, ' '); // normalize spaces
                                        }
                                        if (transArr[idx].s && Array.isArray(transArr[idx].s)) {
                                            opt.sizes = transArr[idx].s.map(s => s.trim().replace(/\s+/g, ' '));
                                        }
                                    });
                                    console.log('Options translation applied successfully.');
                                    translationSuccess = true;
                                } else {
                                     console.error('Translation array length mismatch or invalid format. Retrying...');
                                 }
                             } catch(e) {
                                 console.error(`Options translation failed (Attempt ${transAttempts}/${maxTransAttempts}):`, e.message);
                                 if (e.response) console.error('AI Response Error:', e.response.data);
                                 await delay(1000);
                             }
                         }

                         if (!translationSuccess) {
                             console.log('Warning: Failed to translate options after 3 attempts. Using original (Chinese/Mixed) values.');
                             // We DO NOT skip. We proceed with whatever we have.
                         }
                     } else {
                         console.log('Skipping options translation (AI not ready or no options).');
                     }
                 }

                const enrichedProduct = {
                    product_name: aiData.product_name_ar || 'اسم غير متوفر',
                    // original_name: data.title, // REMOVED as per request
                    main_images: data.images.slice(0, 5),
                    url: productUrl,
                    // product_details: data.productDetails, // REMOVED as per request
                    product_details: aiData.product_details_ar, // Use Arabic details as main 'product_details'
                    // product_details_ar: aiData.product_details_ar, // REMOVED redundancy
                    product_desc_imgs: data.product_desc_imgs || [], // Description Images
                    general_price: general_price,
                    generated_options: generated_options, // New Field
                    aiMetadata: aiData.aiMetadata || {},
                    isAirRestricted: aiData.isAirRestricted || false, // New Field
                    // variants: data.variants, // REMOVED as per request
                    // skuMap: data.skuMap // REMOVED as per request
                };

                // VALIDATION: Skip insertion if options are missing
                if (!enrichedProduct.generated_options || enrichedProduct.generated_options.length === 0) {
                    console.error(`Skipping product: No options generated. URL: ${productUrl}`);
                    // Close tab and continue to next product
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue; 
                }

                // Calculate Final Price with 15% Profit
                const calculateFinalPrice = (base) => {
                    const price = Number(base) || 0;
                    if (price <= 0) return 0;
                    // Formula: (BaseIQD + Domestic) * 1.15 / 250 * 250 (ceil)
                    // Assuming domestic shipping is 0 or handled separately in cart logic, 
                    // but usually scraper stores the inclusive price.
                    // Let's stick to the basic profit margin here.
                    return Math.ceil((price * 1.15) / 250) * 250;
                };

                const finalPrice = calculateFinalPrice(general_price);

                // CHECK: Skip product if price is too low (<= 250 IQD)
                // This usually indicates a failed price extraction or a dummy product
                if (finalPrice <= 250) {
                    console.log(`Skipping product: Price too low (Final: ${finalPrice}, Base: ${general_price}). URL: ${productUrl}`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                products.push(enrichedProduct);
                console.log(`Scraped successfully. Total: ${products.length}`);
                
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2));

                // --- DATABASE INSERTION ---
                console.log('Inserting into Database...');
                try {
                    // 1. Create Product
                    const newProduct = await prisma.product.create({
                        data: {
                            name: enrichedProduct.product_name,
                            price: finalPrice, // Store FINAL price with profit
                            basePriceIQD: enrichedProduct.general_price || 0, // Store BASE price (Cost)
                            image: enrichedProduct.main_images[0] || '',
                            purchaseUrl: enrichedProduct.url,
                            specs: JSON.stringify(enrichedProduct.product_details || {}),
                            aiMetadata: enrichedProduct.aiMetadata || {},
                            isAirRestricted: enrichedProduct.isAirRestricted, // Save to DB
                            status: "PUBLISHED",
                            isActive: true,
                        }
                    });
                    console.log(`Product created: ID ${newProduct.id}`);

                    // 2. Create Product Images (Gallery)
                    if (enrichedProduct.main_images && enrichedProduct.main_images.length > 0) {
                        await prisma.productImage.createMany({
                            data: enrichedProduct.main_images.map((url, i) => ({
                                productId: newProduct.id,
                                url: url,
                                order: i,
                                type: "GALLERY"
                            }))
                        });
                    }

                    // 3. Create Description Images
                    if (enrichedProduct.product_desc_imgs && enrichedProduct.product_desc_imgs.length > 0) {
                        await prisma.productImage.createMany({
                            data: enrichedProduct.product_desc_imgs.map((url, i) => ({
                                productId: newProduct.id,
                                url: url,
                                order: i + 100, // Offset to keep them after gallery
                                type: "DESCRIPTION"
                            }))
                        });
                    }

                    // 4. Create Product Options (Color & Size) - VALIDATED
                    const colors = new Set();
                    const sizes = new Set();
                    
                    // Filter out Chinese characters from options
                    const containsChinese = (str) => /[\u4e00-\u9fa5]/.test(str);
                    
                    // Filter out invalid/suspicious options (Custom orders, deposits, etc.)
                    const invalidKeywords = [
                        '定制', '专拍', '补差', '邮费', '不发货', '联系客服', // Chinese
                        'تخصيص', 'اتصال', 'رابط', 'فرق', 'إيداع', 'لا يرسل', 'خدمة العملاء', 'مخصص' // Arabic
                    ];

                    enrichedProduct.generated_options = enrichedProduct.generated_options.filter(opt => {
                        const text = (opt.color || '') + ' ' + (opt.sizes ? opt.sizes.join(' ') : '');
                        const hasInvalidKeyword = invalidKeywords.some(kw => text.includes(kw));
                        
                        // Also check for suspiciously high price (e.g. > 20x base price)
                        let isPriceSuspicious = false;
                        if (opt.price && enrichedProduct.general_price > 0) {
                             const ratio = opt.price / enrichedProduct.general_price;
                             if (ratio > 20) isPriceSuspicious = true;
                        }

                        if (hasInvalidKeyword || isPriceSuspicious) {
                            console.log(`Skipping invalid/suspicious option: ${text} (Price: ${opt.price})`);
                            return false;
                        }
                        return true;
                    });

                    enrichedProduct.generated_options.forEach(opt => {
                        // Skip entire option if color is Chinese
                        if (opt.color && !containsChinese(opt.color)) {
                            colors.add(opt.color);
                        } else if (opt.color) {
                            // RETRY TRANSLATION FOR SINGLE OPTION
                            // We do a synchronous-like blocking call here or just use it as is if critical?
                            // User said: "try to translate it again if you can't then use it, don't skip generated options"
                            console.log(`Chinese color detected: ${opt.color}. Attempting fallback translation/usage...`);
                            colors.add(opt.color); // Add it anyway, don't skip
                        }

                        if (opt.sizes && Array.isArray(opt.sizes)) {
                            opt.sizes.forEach(s => {
                                if (!containsChinese(s)) {
                                    sizes.add(s);
                                } else {
                                    console.log(`Chinese size detected: ${s}. Using it anyway.`);
                                    sizes.add(s); // Add it anyway, don't skip
                                }
                            });
                        }
                    });

                    // Only create options if we have valid values
                    if (colors.size > 0) {
                        await prisma.productOption.create({
                            data: {
                                productId: newProduct.id,
                                name: "اللون",
                                values: JSON.stringify(Array.from(colors))
                            }
                        });
                    }

                    if (sizes.size > 0) {
                        await prisma.productOption.create({
                            data: {
                                productId: newProduct.id,
                                name: "المقاس",
                                values: JSON.stringify(Array.from(sizes))
                            }
                        });
                    }

                    // 5. Create Variants - VALIDATED
                    const variantsData = [];
                    for (const opt of enrichedProduct.generated_options) {
                        // SKIP if color is Chinese (DISABLED: User wants to keep them)
                        // if (containsChinese(opt.color)) continue;

                        const color = opt.color;
                        let variantBasePrice = opt.price || enrichedProduct.general_price || 0;

                        // Safety check: If price is suspiciously low (likely RMB), multiply by 200
                        // 1000 IQD is about 5 RMB. Most items are > 5 RMB.
                        // If it's < 1000, it's likely raw RMB that missed conversion.
                        // BUT: If the main product price is also low (< 2000), maybe it's just a cheap item?
                        // Let's be stricter: Only multiply if it's REALLY low (< 100) OR if it differs significantly from main price order of magnitude
                        
                        if (variantBasePrice > 0 && variantBasePrice < 100) {
                             console.log(`Warning: Suspiciously low price (${variantBasePrice}). Assuming RMB and multiplying by 200.`);
                             variantBasePrice = variantBasePrice * 200;
                        } else if (variantBasePrice > 0 && variantBasePrice < 1000 && enrichedProduct.general_price > 5000) {
                             // Variant is < 1000 but main product is > 5000? Likely RMB.
                             console.log(`Warning: Variant price ${variantBasePrice} vs Main ${enrichedProduct.general_price}. Assuming RMB.`);
                             variantBasePrice = variantBasePrice * 200;
                        }

                        // CRITICAL FIX: If variant price becomes way higher than main price (e.g. > 10x), clamp it or revert
                        // This handles the case where we accidentally multiplied an already-correct IQD price
                        // Or if the scraper picked up a "bundle" price as a variant price
                        if (enrichedProduct.general_price > 0 && variantBasePrice > enrichedProduct.general_price * 5) {
                            console.log(`Warning: Variant price ${variantBasePrice} is > 5x main price ${enrichedProduct.general_price}. Clamping/Reverting.`);
                            // Revert to main price if it seems totally off, or just divide back if it looks like a double conversion
                            if (variantBasePrice / 200 < enrichedProduct.general_price * 2) {
                                variantBasePrice = variantBasePrice / 200; // It was likely correct before
                            } else {
                                variantBasePrice = enrichedProduct.general_price; // Fallback to main price
                            }
                        }

                        const variantFinalPrice = calculateFinalPrice(variantBasePrice);
                        const variantImg = opt.thumbnail || enrichedProduct.main_images[0] || '';
                        
                        if (opt.sizes && opt.sizes.length > 0) {
                            for (const size of opt.sizes) {
                                // SKIP if size is Chinese (DISABLED: User wants to keep them)
                                // if (containsChinese(size)) continue;

                                // Create structured combination object matching Option Names
                                const combinationObj = {
                                    "اللون": color,
                                    "المقاس": size
                                };
                                
                                variantsData.push({
                                    productId: newProduct.id,
                                    combination: JSON.stringify(combinationObj), // Save as JSON String
                                    price: variantFinalPrice, // Store FINAL price
                                    basePriceIQD: variantBasePrice, // Store BASE price
                                    image: variantImg
                                });
                            }
                        } else {
                            // Single variant (Color only, no size)
                            const combinationObj = {
                                "اللون": color
                            };

                            variantsData.push({
                                productId: newProduct.id,
                                combination: JSON.stringify(combinationObj), // Save as JSON String
                                price: variantFinalPrice, // Store FINAL price
                                basePriceIQD: variantBasePrice, // Store BASE price
                                image: variantImg
                            });
                        }
                    }

                    if (variantsData.length > 0) {
                        await prisma.productVariant.createMany({
                            data: variantsData
                        });
                    }
                    console.log('Database insertion complete.');

                } catch (dbErr) {
                    console.error('Database Insertion Failed:', dbErr.message);
                }

                // --- SKIP DB INSERTION (Local Mode) ---
                // console.log('Skipping Database Insertion (Local Mode)');

            } catch (scrapeErr) {
                console.error('Scrape error:', scrapeErr.message);
            }

            // Clean up
            if (!navigationHappened) {
                await newPage.close();
            } else {
                console.log('Going back to category page...');
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await humanDelay(2000, 3000);
            }

            await humanDelay(2000, 5000);
            
            // Random Delay between 10-15 seconds before next item
            const nextItemDelay = 10000 + Math.random() * 5000;
            console.log(`Waiting ${(nextItemDelay/1000).toFixed(1)}s before next item...`);
            await delay(nextItemDelay);
        } // End of 4-click loop

        // Scroll down to load more items for next pass
        console.log('Finished batch of 4 clicks. Scrolling for more items...');
        await autoScroll(page);
        await humanDelay(3000, 5000);
    }

    console.log('[End] Scraping Complete.');
    await browser.close();
    await prisma.$disconnect();
}

run().catch(err => console.error('Fatal Error:', err));

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

// Force keep-alive
setInterval(() => {
    try {
        fs.appendFileSync('scraper_debug.log', `Tick: ${new Date().toISOString()}\n`);
    } catch(e) {}
}, 5000);
