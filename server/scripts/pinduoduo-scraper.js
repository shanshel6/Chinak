import vanillaPuppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = puppeteerExtra.addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

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

// --- EDIBLE ITEM FILTERING CONFIGURATION ---
const EDIBLE_KEYWORDS = [
    "食品", "零食", "坚果", "罐头", "饮料", "糖果", "饼干", "调料", "茶", "酒", 
    "肉", "蛋", "奶", "油", "米", "面", "果冻", "巧克力", "咖啡", "food", "snack", 
    "nut", "can", "drink", "candy", "biscuit", "seasoning", "tea", "wine", 
    "meat", "egg", "milk", "oil", "rice", "noodle", "jelly", "chocolate", "coffee",
    "吃", "喝", "味", "香", "甜", "辣", "咸", "酸", "苦" // General taste/eating words (use with caution or in combination)
];

// Stricter list for immediate rejection
const STRICT_EDIBLE_KEYWORDS = [
    "食品", "零食", "坚果", "罐头", "饮料", "糖果", "饼干", "调料", "茶叶", "酒水", 
    "鲜肉", "鸡蛋", "牛奶", "食用油", "大米", "面粉", "果冻", "巧克力", "咖啡豆",
    "保健品", "维生素", "钙片", "酵素", "益生菌" // Supplements
];

function isEdiblePreCheck(title, description) {
    const text = (title + " " + description).toLowerCase();
    
    // Check strict keywords first
    for (const keyword of STRICT_EDIBLE_KEYWORDS) {
        if (text.includes(keyword)) {
            return { isEdible: true, keyword: keyword };
        }
    }
    return { isEdible: false };
}

// Initialize AI (DeepInfra)
let aiClient = null;

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) > 0 ? Number(process.env.AI_TIMEOUT_MS) : 180000;
const AI_MAX_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS) > 0 ? Number(process.env.AI_MAX_ATTEMPTS) : 5;
const AI_BASE_RETRY_DELAY_MS = Number(process.env.AI_BASE_RETRY_DELAY_MS) > 0 ? Number(process.env.AI_BASE_RETRY_DELAY_MS) : 1500;

const PUPPETEER_PROTOCOL_TIMEOUT_MS =
  Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS) > 0
    ? Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS)
    : 180000;
const PUPPETEER_DEFAULT_TIMEOUT_MS =
  Number(process.env.PUPPETEER_DEFAULT_TIMEOUT_MS) > 0
    ? Number(process.env.PUPPETEER_DEFAULT_TIMEOUT_MS)
    : 120000;

let AI_PRIMARY_MODEL = process.env.AI_MODEL || "qwen/qwen-vl-plus";
let AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || AI_PRIMARY_MODEL;
let AI_MODEL = AI_PRIMARY_MODEL;
if (process.env.DEEPINFRA_API_KEY) {
    AI_PRIMARY_MODEL = process.env.DEEPINFRA_MODEL || process.env.AI_MODEL || "google/gemma-3-27b-it";
    AI_FALLBACK_MODEL = process.env.DEEPINFRA_FALLBACK_MODEL || "Qwen/Qwen3-32B-Instruct";
    AI_MODEL = AI_PRIMARY_MODEL;
    aiClient = new OpenAI({
        baseURL: "https://api.deepinfra.com/v1/openai",
        apiKey: process.env.DEEPINFRA_API_KEY,
        timeout: AI_TIMEOUT_MS,
        maxRetries: 0,
    });
    console.log(`AI Initialized (DeepInfra: primary=${AI_PRIMARY_MODEL}, fallback=${AI_FALLBACK_MODEL})`);
} else if (process.env.SILICONFLOW_API_KEY) {
    // Fallback to SiliconFlow if DeepInfra not set (backward compatibility)
    AI_PRIMARY_MODEL = process.env.SILICONFLOW_MODEL || process.env.AI_MODEL || AI_PRIMARY_MODEL;
    AI_FALLBACK_MODEL = process.env.SILICONFLOW_FALLBACK_MODEL || process.env.AI_FALLBACK_MODEL || AI_PRIMARY_MODEL;
    AI_MODEL = AI_PRIMARY_MODEL;
    aiClient = new OpenAI({
        baseURL: "https://api.siliconflow.cn/v1",
        apiKey: process.env.SILICONFLOW_API_KEY,
        timeout: AI_TIMEOUT_MS,
        maxRetries: 0,
    });
    console.log(`AI Initialized (SiliconFlow: primary=${AI_PRIMARY_MODEL}, fallback=${AI_FALLBACK_MODEL})`);
} else {
    console.log('Warning: No AI API KEY found. AI features will use mock data.');
}

const isModelBusyError = (e) => {
    const message = (e && e.message) ? String(e.message) : String(e);
    const code = (e && e.code) ? e.code : '';
    return (
        message.includes('429') ||
        String(code) === '429' ||
        message.toLowerCase().includes('model busy') ||
        message.toLowerCase().includes('rate limit') ||
        message.toLowerCase().includes('too many requests')
    );
};

const isTimeoutError = (e) => {
    const message = (e && e.message) ? String(e.message) : String(e);
    const name = (e && e.name) ? String(e.name) : '';
    const code = (e && e.code) ? String(e.code) : '';
    const status = (e && typeof e.status !== 'undefined') ? String(e.status) : '';
    return (
        name.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('timeout') ||
        code === 'ETIMEDOUT' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'ECONNRESET' ||
        message.toLowerCase().includes('socket hang up') ||
        status === '408'
    );
};

const AI_BUSY_FALLBACK_MODEL = "Qwen/Qwen3-30B-A3B";


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
        const safeTitle = String(title || '').slice(0, 220);
        const safeDescription = String(description || '').slice(0, 1200);
        const safePrice = String(price || '').slice(0, 50);

        const prompt = `
        You are a product data enrichment assistant for an Iraqi e-commerce site.
        
        Original Product Title (Chinese): "${safeTitle}"
        Product Description: "${safeDescription}"
        Price: "${safePrice}"

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
            - "synonyms": Array of 3-5 alternative Arabic names SPECIFIC to this product.
            - "market_tags": Array of 3-5 relevant tags in Arabic.
            - "category_suggestion": A specific category path in Arabic.
        6. DETECT IF THE PRODUCT IS EDIBLE (Food, Drink, Nuts, Cans, Snacks, Ingredients, Supplements, Vitamins, Medicine).
            - Set "is_edible": true if it is food/edible/supplement.
            - Set "is_edible": false if it is NOT edible (e.g. clothes, electronics, tools).
            - BE VERY CAREFUL. "Food Container" is NOT edible. "Dog Food" IS edible (sort of, but usually restricted). "Almond Oil for Skin" is NOT edible (cosmetic). "Almond Oil for Cooking" IS edible.
            - If in doubt, set true to be safe.

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
            "is_edible": false,
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
        
        while (attempts < AI_MAX_ATTEMPTS) {
            try {
                const create = async (model) => {
                    return await aiClient.chat.completions.create({
                        model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.2,
                        max_tokens: 900,
                    });
                };

                let response;
                try {
                    response = await create(AI_PRIMARY_MODEL);
                } catch (e) {
                    if (isTimeoutError(e)) {
                        throw e;
                    }
                    if (isModelBusyError(e)) {
                        console.log(`AI busy on ${AI_PRIMARY_MODEL}. Falling back to ${AI_BUSY_FALLBACK_MODEL}...`);
                        response = await create(AI_BUSY_FALLBACK_MODEL);
                    } else if (AI_FALLBACK_MODEL && AI_FALLBACK_MODEL !== AI_PRIMARY_MODEL) {
                        console.log(`AI error on ${AI_PRIMARY_MODEL}. Falling back to ${AI_FALLBACK_MODEL}...`);
                        response = await create(AI_FALLBACK_MODEL);
                    } else {
                        throw e;
                    }
                }

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
                const message = (e && e.message) ? e.message : String(e);
                console.error(`AI Error (Attempt ${attempts}/${AI_MAX_ATTEMPTS}):`, message);

                const isRateLimit = isModelBusyError(e) || message.includes('429');
                const isTimeout = isTimeoutError(e);

                if (isRateLimit) {
                    const waitTime = Math.min(45000, 5000 * attempts) + Math.floor(Math.random() * 1000);
                    console.log(`Rate limit hit. Waiting ${(waitTime / 1000).toFixed(1)}s...`);
                    await delay(waitTime);
                    continue;
                }

                if (isTimeout) {
                    const waitTime = Math.min(45000, AI_BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempts - 1))) + Math.floor(Math.random() * 1000);
                    await delay(waitTime);
                    continue;
                }

                await delay(2000 + Math.floor(Math.random() * 500));
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

async function applyPageTimeouts(page) {
    if (!page) return;
    try { page.setDefaultTimeout(PUPPETEER_DEFAULT_TIMEOUT_MS); } catch (e) {}
    try { page.setDefaultNavigationTimeout(PUPPETEER_DEFAULT_TIMEOUT_MS); } catch (e) {}
}

async function waitForStableUrl(page, stableMs = 1200, timeoutMs = 12000) {
    const start = Date.now();
    let lastUrl = '';
    let lastChangeAt = Date.now();
    try { lastUrl = page.url(); } catch (e) { lastUrl = ''; }
    lastChangeAt = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (!page || (page.isClosed && page.isClosed())) return lastUrl;
        await delay(200);
        let cur = '';
        try { cur = page.url(); } catch (e) { cur = lastUrl; }
        if (cur && cur !== lastUrl) {
            lastUrl = cur;
            lastChangeAt = Date.now();
        }
        if (Date.now() - lastChangeAt >= stableMs) return lastUrl;
    }
    return lastUrl;
}

async function safeEvaluate(page, pageFunction, args = [], maxAttempts = 4) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await page.evaluate(pageFunction, ...args);
        } catch (e) {
            lastErr = e;
            const msg = String(e?.message || e || '');
            const isContextDestroyed =
                msg.includes('Execution context was destroyed') ||
                msg.includes('Cannot find context') ||
                msg.includes('Target closed') ||
                msg.includes('Session closed') ||
                msg.includes('Most likely the page has been closed') ||
                msg.includes('Navigating frame was detached') ||
                msg.includes('frame was detached');

            if (!isContextDestroyed) throw e;

            try {
                await delay(300 * attempt);
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
                    waitForStableUrl(page, 1400, 12000)
                ]);
            } catch (e2) {}
        }
    }
    throw lastErr || new Error('safeEvaluate failed');
}

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
    protocolTimeout: PUPPETEER_PROTOCOL_TIMEOUT_MS,
    // userDataDir: 'chrome_data_pdd_fresh_v36',
    userDataDir: 'chrome_data_pdd_persistent', // Use fixed directory to keep session alive
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--lang=zh-CN,zh'
    ]
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
    await applyPageTimeouts(page);
    
    // --- STEALTH MEASURES ---
    
    // 1. Set Mobile Viewport (Android)
    // await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
    
    // Switch to Desktop Viewport
    await page.setViewport({ width: 1366, height: 768 });
    
    // 2. Override Navigator Properties to mimic Android
    await page.evaluateOnNewDocument(() => {
        // Force language to Chinese
        Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
        
        // Add minimal mouse movement to simulate human
        window.addEventListener('load', () => {
             document.body.addEventListener('mousemove', () => {});
             document.body.addEventListener('touchstart', () => {});
        });
    });

    // 4. Load cookies if exist
    try {
        const cookiePath = path.join(__dirname, 'pdd_cookies.json');
        if (fs.existsSync(cookiePath)) {
            const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            if (cookies.length > 0) {
                console.log(`Loading ${cookies.length} saved cookies...`);
                await page.setCookie(...cookies);
            }
        }
    } catch (err) {
        console.error('Failed to load cookies:', err.message);
    }

    // 5. Perform Login DIRECTLY on the target Category Page
    // Why? Navigating from Home -> Category often triggers "Drifting" or "Bot Detection".
    // It's better to just go straight to the category, log in there if needed, and then start scraping.
    
    // FORCE LOGIN NAVIGATION IF NOT LOGGED IN
    console.log('Visiting Login URL first to ensure valid session...');
    try {
        await page.goto('https://mobile.pinduoduo.com/login.html', { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    } catch(e) { console.log('Login goto error (might be redirect):', e.message); }
    
    console.log('Login page loaded (or redirected).');

    console.log('================================================================');
    console.log('  PAUSING FOR MANUAL LOGIN (30 seconds)');
    console.log('  1. Please login manually using SMS/Phone.');
    console.log('  2. Once logged in, you should see the home page.');
    console.log('  3. The script will then redirect to the category page.');
    console.log('================================================================');
    await delay(30000); 

    // CLEAN CATEGORY URL to remove tracking params
    let cleanUrl = CATEGORY_URL;
    try {
        const u = new URL(CATEGORY_URL);
        const searchKey = u.searchParams.get('search_key');
        const catId = u.searchParams.get('cat_id');
        const optId = u.searchParams.get('opt_id');
        
        // Construct a clean URL
        if (searchKey) {
            cleanUrl = `https://mobile.pinduoduo.com/search_result.html?search_key=${encodeURIComponent(searchKey)}&search_type=goods`;
        } else if (catId) {
            cleanUrl = `https://mobile.pinduoduo.com/catgoods.html?cat_id=${catId}&opt_id=${optId || catId}`;
        } else if (optId) {
                cleanUrl = `https://mobile.pinduoduo.com/catgoods.html?opt_id=${optId}`;
        }
        
        console.log('Original URL:', CATEGORY_URL);
        console.log('Cleaned URL:', cleanUrl);
    } catch(e) {
        console.log('Error cleaning URL:', e.message);
        cleanUrl = CATEGORY_URL; // Fallback
    }

    console.log('Visiting Clean Category URL:', cleanUrl);
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    console.log('Category page loaded.');
    
    // SWITCH TO MOBILE VIEWPORT AFTER LOGIN & NAVIGATION
    console.log('Switching to Mobile Viewport for scraping...');
    await page.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
    await delay(2000);
    
    /*
    console.log('Visiting Category URL (and performing login check there):', CATEGORY_URL);
    await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
    console.log('Goto done');

    console.log('================================================================');
    console.log('  PAUSING FOR MANUAL LOGIN / CHECK (40 seconds)');
    console.log('  1. If you see a login screen, please log in.');
    console.log('  2. If you see "Sold Out", try refreshing manually.');
    console.log('  3. Make sure you see the product list before this timer ends.');
    console.log('================================================================');
    console.log('Starting delay...');
    await delay(40000); 
    console.log('Delay finished. Resuming...');
    */
    
    // SAVE COOKIES AFTER LOGIN
    try {
        const cookies = await page.cookies();
        const cookiePath = path.join(__dirname, 'pdd_cookies.json');
        fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
        console.log('✅ Login cookies saved to pdd_cookies.json');
    } catch (err) {
        console.error('Failed to save cookies:', err.message);
    }

    // Wait extra time for the page to fully stabilize
    console.log('Waiting 5s for page stabilization...');
    await delay(5000);

    // --- SCROLL PAST HEADER ---
    console.log('Scrolling down to bypass header/category icons...');
    
    try {
        // Scroll down one full screen height + a bit more
        await page.evaluate(async () => {
            const viewportHeight = window.innerHeight;
            window.scrollBy(0, viewportHeight + 200);
            await new Promise(r => setTimeout(r, 1000));
        });
    } catch (e) {
        console.warn('⚠️ Scroll error (ignoring):', e.message);
        // If execution context destroyed, it usually means page refreshed or navigated.
        // We can just wait a bit and proceed.
        await delay(1000);
    }
    
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

        // DISABLE AUTO-REDIRECT for now - it's causing loops if the URL format changes slightly
        // if (isHomePage || (requiredParam && !currentUrlBeforeScroll.includes(decodeURIComponent(requiredParam)) && !currentUrlBeforeScroll.includes(requiredParam))) {
        //      console.log('WARNING: Drifted away from category page. Redirecting back to:', CATEGORY_URL);
        //      await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        //      await humanDelay(3000, 5000);
        // }

        
            // --- 4-POINT BLIND CLICK STRATEGY ---
        console.log('Scrolling down to find new batch of products...');
        
        // 1. Scroll down one screen size + a bit
        try {
            await page.evaluate(async () => {
                // Random scroll
                const viewportHeight = window.innerHeight;
                const distance = viewportHeight + 100 + Math.floor(Math.random() * 200);
                window.scrollBy(0, distance);
                await new Promise(r => setTimeout(r, 1000));
            });
        } catch (e) {
             console.warn('⚠️ Scroll error in loop (recovering):', e.message);
             // Wait and reload context if needed
             await delay(2000);
             if (page.isClosed()) break;
             continue; // Skip this iteration
        }
        
        await humanDelay(2000, 3000);

        // Define the 4 click points (percentages of viewport)
        // Adjust for Mobile Viewport in Desktop Browser
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
                // Use evaluating touchstart for mobile simulation if mouse click fails
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
                    await applyPageTimeouts(newPage);
                    
                    // STEALTH: Ensure new page looks like it came from the main page
                    await newPage.bringToFront();
                    
                    // IMPORTANT: Set viewport for the new tab too!
                    await newPage.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true });
                    
                    try {
                        await newPage.setExtraHTTPHeaders({ 
                            'Referer': currentUrl,
                            // 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' // Already handled by args
                        });
                    } catch(e) {}
                } else {
                    console.log('No new tab. Checking if current page navigated...');
                    await delay(2000); 
                    if (page.url() !== currentUrl && !page.url().includes('catgoods')) {
                        console.log('Current page navigated. Treating as product page.');
                        newPage = page;
                        navigationHappened = true;
                        await applyPageTimeouts(newPage);
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
                await waitForStableUrl(newPage, 1200, 12000);

                // CHECK FOR "SOLD OUT" STATE
                const isLogin = await safeEvaluate(newPage, () => {
                    const t = (document.body && document.body.innerText) ? document.body.innerText : '';
                    const s = String(t || '');
                    return s.includes('登录') && (s.includes('扫码登录') || s.includes('同意服务协议') || s.includes('隐私政策'));
                }, [], 12);

                if (isLogin) {
                    console.log('⚠️ Hit login page. Skipping product and returning to listing...');
                    if (!navigationHappened && newPage.close) await newPage.close();
                    else {
                        try {
                            await newPage.goBack({ waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                        } catch (e) {
                            try {
                                await newPage.goto(currentUrl || CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                            } catch (e2) {}
                        }
                    }
                    continue;
                }

                const isSoldOut = await safeEvaluate(newPage, () => {
                    const text = document.body.innerText;
                    return text.includes('商品已售罄') || text.includes('已售完') || text.includes('下架');
                });

                if (isSoldOut) {
                    console.log('⚠️ Product is SOLD OUT (or Anti-Bot triggered). Skipping...');
                    console.log('   -> Hint: If this happens for ALL products, try deleting pdd_cookies.json and re-login.');
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

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

                const openOptionsModalIfNeeded = async (page) => {
                    const modalSelector = '.HidQ9ROd, div[role="dialog"][aria-modal="true"], div[role="dialog"]';

                    const hasVisibleSkuModal = async () => {
                        return await page.evaluate((sel) => {
                            const visible = (el) => {
                                if (!el) return false;
                                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                                const style = window.getComputedStyle(el);
                                if (!style) return false;
                                if (style.display === 'none' || style.visibility === 'hidden') return false;
                                const opacity = parseFloat(style.opacity || '1');
                                if (!Number.isNaN(opacity) && opacity <= 0.02) return false;
                                const r = el.getBoundingClientRect();
                                if (!r || r.width < 40 || r.height < 40) return false;
                                const intersects =
                                    r.bottom > 0 &&
                                    r.right > 0 &&
                                    r.top < window.innerHeight &&
                                    r.left < window.innerWidth;
                                if (!intersects) return false;
                                const x = Math.floor(Math.min(window.innerWidth - 2, Math.max(1, r.left + r.width * 0.5)));
                                const y = Math.floor(Math.min(window.innerHeight - 2, Math.max(1, r.top + r.height * 0.5)));
                                const top = document.elementFromPoint(x, y);
                                if (top && (el === top || el.contains(top))) return true;
                                return false;
                            };

                            const isSku = (m) => {
                                try {
                                    if (m && m.matches && m.matches('.HidQ9ROd')) return true;
                                } catch (e) {}
                                if (m && m.querySelector && m.querySelector('.iW4aEGbb')) return false;
                                const t = String(m?.innerText || m?.textContent || '');
                                if (t.includes('已选') || t.includes('请选择') || t.includes('规格')) return true;
                                if (m.querySelector('.O7pEFvHR') || m.querySelector('.bIhLWVqm') || m.querySelector('li.TpUpcNRp') || m.querySelector('div._8gg8ho2u')) return true;
                                return false;
                            };

                            const modals = Array.from(document.querySelectorAll(sel));
                            return modals.some(m => visible(m) && isSku(m));
                        }, modalSelector).catch(() => false);
                    };

                    if (await hasVisibleSkuModal()) {
                        console.log('[PDD] Options modal already open');
                        return true;
                    }

                    const tryClickAndWaitModal = async (x, y, modalWaitMs = 2500) => {
                        let before = '';
                        try { before = page.url(); } catch (e) { before = ''; }

                        try {
                            try { await page.mouse.move(Math.max(1, x - 18), Math.max(1, y - 18)); } catch (e) {}
                            await humanDelay(700, 1200);
                            await page.mouse.click(x, y);
                        } catch (e) {
                            return false;
                        }

                        await humanDelay(1200, 2200);
                        const ok = await page.waitForFunction(
                            (sel) => {
                                const visible = (el) => {
                                    if (!el) return false;
                                    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                                    const style = window.getComputedStyle(el);
                                    if (!style) return false;
                                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                                    const opacity = parseFloat(style.opacity || '1');
                                    if (!Number.isNaN(opacity) && opacity <= 0.02) return false;
                                    const r = el.getBoundingClientRect();
                                    if (!r || r.width < 40 || r.height < 40) return false;
                                    const intersects =
                                        r.bottom > 0 &&
                                        r.right > 0 &&
                                        r.top < window.innerHeight &&
                                        r.left < window.innerWidth;
                                    if (!intersects) return false;
                                    const x = Math.floor(Math.min(window.innerWidth - 2, Math.max(1, r.left + r.width * 0.5)));
                                    const y = Math.floor(Math.min(window.innerHeight - 2, Math.max(1, r.top + r.height * 0.5)));
                                    const top = document.elementFromPoint(x, y);
                                    if (top && (el === top || el.contains(top))) return true;
                                    return false;
                                };

                                const isSku = (m) => {
                                    try {
                                        if (m && m.matches && m.matches('.HidQ9ROd')) return true;
                                    } catch (e) {}
                                    if (m && m.querySelector && m.querySelector('.iW4aEGbb')) return false;
                                    const t = String(m?.innerText || m?.textContent || '');
                                    if (t.includes('已选') || t.includes('请选择') || t.includes('规格')) return true;
                                    if (m.querySelector('.O7pEFvHR') || m.querySelector('.bIhLWVqm') || m.querySelector('li.TpUpcNRp') || m.querySelector('div._8gg8ho2u')) return true;
                                    return false;
                                };

                                const modals = Array.from(document.querySelectorAll(sel));
                                return modals.some(m => visible(m) && isSku(m));
                            },
                            { timeout: modalWaitMs },
                            modalSelector
                        ).catch(() => null);
                        if (ok) return true;

                        let after = '';
                        try { after = page.url(); } catch (e) { after = before; }
                        if (after.includes('/order_checkout.html') || after.includes('order_checkout.html')) {
                            try {
                                await page.goBack({ waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
                                await waitForStableUrl(page, 1400, 15000);
                            } catch (e) {}
                        }

                        return false;
                    };

                    await waitForStableUrl(page, 1200, 15000);

                    const getViewport = async () => {
                        const vp = (page.viewport && page.viewport()) ? page.viewport() : null;
                        if (vp && vp.width && vp.height) return { width: vp.width, height: vp.height };
                        const ev = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null);
                        return { width: ev?.width || 360, height: ev?.height || 800 };
                    };

                    const tryOpenViaBottomRight = async (modalWaitMs = 9000) => {
                        const vp = await getViewport();
                        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                        const maxX = Math.floor(vp.width - 2);
                        const maxY = Math.floor(vp.height - 2);
                        const marginX = 3 + Math.floor(Math.random() * 9);
                        const marginY = 1 + Math.floor(Math.random() * 6);

                        const x = clamp(maxX - marginX, 1, maxX);
                        const y = clamp(maxY - marginY, 1, maxY);

                        console.log(`[PDD] Trying to open options via bottom-right click (x=${x},y=${y})`);
                        return await tryClickAndWaitModal(x, y, modalWaitMs);
                    };

                    for (let attempt = 0; attempt < 5; attempt++) {
                        if (attempt > 0) await humanDelay(1400, 2600);
                        const ok = await tryOpenViaBottomRight(9000);
                        if (ok) return true;
                    }

                    return false;
                };

                const clickO7pEFvHRAndWait = async (page, scopeSelectors = null) => {
                    const closeIfIwwPopupOpened = async () => {
                        const pt = await page.evaluate(() => {
                            const popup = document.querySelector('.iW4aEGbb');
                            if (!popup) return null;
                            const close =
                                popup.querySelector('div[role="button"][aria-label*="关闭"]') ||
                                popup.querySelector('button[aria-label*="关闭"]') ||
                                popup.querySelector('div[role="button"][aria-label="关闭弹窗"]') ||
                                popup.querySelector('div[role="button"][aria-label="关闭"]') ||
                                popup.querySelector('button') ||
                                null;
                            const el = close || popup;
                            const r = el.getBoundingClientRect();
                            if (!r || r.width < 4 || r.height < 4) return { x: Math.floor(window.innerWidth / 2), y: Math.floor(window.innerHeight * 0.2) };
                            const x = Math.floor(r.left + r.width * 0.5);
                            const y = Math.floor(r.top + r.height * 0.5);
                            return { x, y };
                        }).catch(() => null);

                        if (!pt?.x || !pt?.y) return false;

                        try {
                            for (let i = 0; i < 2; i++) {
                                try { await page.mouse.move(Math.max(1, pt.x - 16), Math.max(1, pt.y - 16)); } catch (e) {}
                                await humanDelay(450, 900);
                                await page.mouse.click(pt.x, pt.y);
                                await humanDelay(650, 1200);
                                const still = await page.$('.iW4aEGbb').catch(() => null);
                                if (!still) return true;
                            }
                        } catch (e) {}
                        return false;
                    };

                    const clickNormalizedPoint = async (nx, ny) => {
                        const vp = (page.viewport && page.viewport()) ? page.viewport() : null;
                        const width = (vp && vp.width) ? vp.width : 360;
                        const height = (vp && vp.height) ? vp.height : 800;
                        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                        const x = clamp(Math.floor((Number(nx) / 1000) * width), 1, Math.floor(width - 2));
                        const y = clamp(Math.floor((Number(ny) / 1000) * height), 1, Math.floor(height - 2));
                        try {
                            try { await page.mouse.move(Math.max(1, x - 18), Math.max(1, y - 18)); } catch (e) {}
                            await humanDelay(650, 1200);
                            await page.mouse.click(x, y);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    };

                    const clickCenterLeft = async () => {
                        const pt = await page.evaluate(() => {
                            const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                            const modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('div[role="dialog"]');
                            if (modal) {
                                const r = modal.getBoundingClientRect();
                                if (r && r.width > 40 && r.height > 40) {
                                    const x = clamp(Math.floor(r.left + r.width * 0.25), 1, Math.floor(window.innerWidth - 2));
                                    const y = clamp(Math.floor(r.top + r.height * 0.5), 1, Math.floor(window.innerHeight - 2));
                                    return { x, y };
                                }
                            }
                            const x = clamp(Math.floor(window.innerWidth * 0.25), 1, Math.floor(window.innerWidth - 2));
                            const y = clamp(Math.floor(window.innerHeight * 0.5), 1, Math.floor(window.innerHeight - 2));
                            return { x, y };
                        }).catch(() => null);

                        if (!pt?.x || !pt?.y) return false;
                        try {
                            try { await page.mouse.move(Math.max(1, pt.x - 18), Math.max(1, pt.y - 18)); } catch (e) {}
                            await humanDelay(650, 1200);
                            await page.mouse.click(pt.x, pt.y);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    };

                    const nudgeModalScroll = async () => {
                        if (!scopeSelectors) return;
                        const did = await page.evaluate(() => {
                            const modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('div[role="dialog"]');
                            if (!modal) return false;
                            const all = [modal, ...Array.from(modal.querySelectorAll('*'))];
                            const scroller = all.find(el => {
                                try {
                                    return el.scrollHeight > el.clientHeight + 80;
                                } catch (e) {
                                    return false;
                                }
                            });
                            if (!scroller) return false;
                            const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
                            if (max <= 0) return false;
                            const next = Math.min(max, scroller.scrollTop + Math.floor(scroller.clientHeight * 0.6));
                            scroller.scrollTop = next;
                            return true;
                        }).catch(() => false);
                        if (did) await humanDelay(650, 1200);
                    };

                    const waitForOptionsList = async (timeoutMs = 6000) => {
                        const fast = await page.waitForSelector('li.TpUpcNRp, div._8gg8ho2u', { timeout: Math.min(2500, timeoutMs) }).catch(() => null);
                        if (fast) return true;
                        const ok = await page.waitForFunction(() => {
                            const modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('div[role="dialog"]');
                            const root = modal || document;
                            const groupCount = root.querySelectorAll('.bIhLWVqm').length;
                            const optionCount = root.querySelectorAll('.bIhLWVqm .F7sZG3xe, .bIhLWVqm .s1O5M5fO .F7sZG3xe, .s1O5M5fO .F7sZG3xe').length;
                            if (groupCount > 0 && optionCount >= 2) return true;
                            const nodes = Array.from(root.querySelectorAll('li, div[role="button"], button, a'));
                            let count = 0;
                            for (const el of nodes) {
                                const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                                if (!t) continue;
                                if (!t.includes('¥') && !t.includes('￥')) continue;
                                const r = el.getBoundingClientRect();
                                if (!r || r.width < 40 || r.height < 16 || r.height > 140) continue;
                                count++;
                                if (count >= 2) return true;
                            }
                            return false;
                        }, { timeout: timeoutMs }).catch(() => null);
                        return !!ok;
                    };

                    if (scopeSelectors) {
                        console.log('[PDD] Trying normalized click to open thumbnails/options (x=159,y=447)');
                        const ok = await clickNormalizedPoint(159, 447);
                        if (ok) {
                            await closeIfIwwPopupOpened();
                            await nudgeModalScroll();
                            const hasAfter = await waitForOptionsList(7000);
                            if (hasAfter) {
                                console.log('[PDD] Options detected after normalized click');
                                return true;
                            }
                        }
                    }

                    const pickClickable = async (selector) => {
                        const handles = await page.$$(selector).catch(() => []);
                        for (const h of handles) {
                            const box = await h.boundingBox().catch(() => null);
                            if (!box) continue;
                            if (box.width < 3 || box.height < 3) continue;
                            return { handle: h, box };
                        }
                        return null;
                    };

                    const clickByBox = async (box) => {
                        const x = Math.floor(box.x + box.width * 0.5);
                        const y = Math.floor(box.y + box.height * 0.5);
                        try { await page.mouse.move(Math.max(1, x - 18), Math.max(1, y - 18)); } catch (e) {}
                        await humanDelay(550, 1100);
                        await page.mouse.click(x, y);
                    };

                    const selectors = [];
                    if (!scopeSelectors) {
                        selectors.push('.O7pEFvHR', '.O7pEFvHR img');
                    } else {
                        const scopes = Array.isArray(scopeSelectors) ? scopeSelectors : [scopeSelectors];
                        for (const s of scopes) {
                            selectors.push(`${s} .O7pEFvHR`, `${s} .O7pEFvHR img`);
                        }
                    }

                    console.log(`[PDD] Trying to click O7pEFvHR via ${selectors.length} selectors`);
                    let target = null;
                    let usedSelector = '';
                    for (const sel of selectors) {
                        const picked = await pickClickable(sel);
                        if (picked) {
                            target = picked;
                            usedSelector = sel;
                            break;
                        }
                    }

                    if (!target) {
                        if (!scopeSelectors) {
                            console.log('[PDD] O7pEFvHR not found/clickable (no modal scope); skipping heuristic click');
                            return false;
                        }

                        console.log('[PDD] O7pEFvHR not found/clickable; trying heuristic click inside SKU popup');

                        const scopes = scopeSelectors
                            ? (Array.isArray(scopeSelectors) ? scopeSelectors : [scopeSelectors])
                            : [];
                        const pt = await page.evaluate((scopeSelList) => {
                            const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                            const toPt = (r) => {
                                const x = clamp(Math.floor(r.left + r.width * 0.5), 1, Math.floor(window.innerWidth - 2));
                                const y = clamp(Math.floor(r.top + r.height * 0.5), 1, Math.floor(window.innerHeight - 2));
                                return { x, y };
                            };

                            const visibleRect = (r) => {
                                if (!r || r.width < 12 || r.height < 12) return false;
                                if (r.bottom < 0 || r.right < 0) return false;
                                if (r.top > window.innerHeight || r.left > window.innerWidth) return false;
                                return true;
                            };

                            const isGoodSrc = (src) => {
                                const s = String(src || '');
                                if (!s) return false;
                                if (!s.startsWith('http')) return false;
                                if (s.includes('avatar') || s.includes('icon') || s.includes('coupon')) return false;
                                return true;
                            };

                            const areas = [];
                            const roots = [];
                            if (scopeSelList && scopeSelList.length > 0) {
                                for (const sel of scopeSelList) {
                                    const el = document.querySelector(sel);
                                    if (el) roots.push(el);
                                }
                            }
                            if (roots.length === 0) roots.push(document);

                            for (const root of roots) {
                                const imgs = Array.from(root.querySelectorAll('img'));
                                for (const img of imgs) {
                                    if (img.closest && img.closest('.iW4aEGbb')) continue;
                                    const r = img.getBoundingClientRect();
                                    if (!visibleRect(r)) continue;
                                    if (!isGoodSrc(img.currentSrc || img.src)) continue;
                                    const score = r.width * r.height;
                                    areas.push({ score, rect: r });
                                }
                                const divs = Array.from(root.querySelectorAll('div[role="button"], button'));
                                for (const el of divs) {
                                    if (el.closest && el.closest('.iW4aEGbb')) continue;
                                    const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                                    if (!t) continue;
                                    if (!t.includes('图') && !t.includes('图片')) continue;
                                    const r = el.getBoundingClientRect();
                                    if (!visibleRect(r)) continue;
                                    const score = r.width * r.height * 0.6;
                                    areas.push({ score, rect: r });
                                }
                            }

                            areas.sort((a, b) => b.score - a.score);
                            const best = areas[0];
                            if (!best) return null;
                            return toPt(best.rect);
                        }, scopes).catch(() => null);

                        if (!pt?.x || !pt?.y) return false;

                        try {
                            try { await page.mouse.move(Math.max(1, pt.x - 18), Math.max(1, pt.y - 18)); } catch (e) {}
                            await humanDelay(600, 1200);
                            await page.mouse.click(pt.x, pt.y);
                            console.log('[PDD] Heuristic click executed');
                            await closeIfIwwPopupOpened();
                            await nudgeModalScroll();
                        } catch (e) {
                            return false;
                        }
                    }

                    if (target) {
                        console.log(`[PDD] Clicking O7pEFvHR using: ${usedSelector}`);
                        try {
                            await page.evaluate((sel) => {
                                const el = document.querySelector(sel);
                                if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
                            }, usedSelector).catch(() => null);
                            await humanDelay(500, 900);
                            const pt = await page.evaluate((sel) => {
                                const el = document.querySelector(sel);
                                if (!el) return null;
                                const r = el.getBoundingClientRect();
                                if (!r || r.width < 4 || r.height < 4) return null;
                                const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                                const xs = [0.5, 0.35, 0.65, 0.2, 0.8].map(p => Math.floor(r.left + r.width * p));
                                const ys = [0.5, 0.35, 0.65, 0.2, 0.8].map(p => Math.floor(r.top + r.height * p));
                                for (const y of ys) {
                                    for (const x of xs) {
                                        const xx = clamp(x, 1, Math.floor(window.innerWidth - 2));
                                        const yy = clamp(y, 1, Math.floor(window.innerHeight - 2));
                                        const top = document.elementFromPoint(xx, yy);
                                        if (top && (el === top || el.contains(top))) return { x: xx, y: yy };
                                    }
                                }
                                return null;
                            }, usedSelector).catch(() => null);

                            if (pt?.x && pt?.y) {
                                try { await page.mouse.move(Math.max(1, pt.x - 18), Math.max(1, pt.y - 18)); } catch (e) {}
                                await humanDelay(550, 1100);
                                await page.mouse.click(pt.x, pt.y);
                            } else {
                                const refreshed = await pickClickable(usedSelector);
                                if (refreshed?.box) target = refreshed;
                                await clickByBox(target.box);
                            }
                            console.log('[PDD] Clicked O7pEFvHR');
                            await closeIfIwwPopupOpened();
                            await nudgeModalScroll();
                        } catch (e) {
                            console.log(`[PDD] O7pEFvHR click failed: ${e?.message || e}`);
                            return false;
                        }
                    }

                    const has = await waitForOptionsList(7000);
                    if (has) {
                        console.log('[PDD] Options list detected');
                        return true;
                    }

                    console.log('[PDD] Options list not detected; trying center-left click inside modal');
                    try {
                        const ok = await clickCenterLeft();
                        if (ok) {
                            await closeIfIwwPopupOpened();
                            await nudgeModalScroll();
                            const hasAfter = await waitForOptionsList(7000);
                            if (hasAfter) {
                                console.log('[PDD] Options list detected after center-left click');
                                return true;
                            }
                        }
                    } catch (e) {}

                    const fallbackCounts = await page.evaluate(() => {
                        const modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('div[role="dialog"]');
                        const root = modal || document;
                        const li = root.querySelectorAll('li').length;
                        const buttons = root.querySelectorAll('button, div[role="button"]').length;
                        const groups = root.querySelectorAll('.bIhLWVqm').length;
                        const opts = root.querySelectorAll('.bIhLWVqm .F7sZG3xe, .s1O5M5fO .F7sZG3xe').length;
                        return { li, buttons, groups, opts };
                    }).catch(() => ({ li: 0, buttons: 0 }));
                    console.log(`[PDD] Options list not detected (li=${fallbackCounts.li}, buttons=${fallbackCounts.buttons}, groups=${fallbackCounts.groups || 0}, opts=${fallbackCounts.opts || 0})`);
                    return false;
                };

                console.log('[PDD] Opening options popup before clicking O7pEFvHR');
                const optionsModalOpened = await openOptionsModalIfNeeded(newPage);
                let hasOptionsList = false;
                if (optionsModalOpened) {
                    hasOptionsList = await clickO7pEFvHRAndWait(newPage, [
                        '.HidQ9ROd',
                        'div[role="dialog"][aria-modal="true"]',
                        'div[role="dialog"]'
                    ]);
                } else {
                    console.log('[PDD] Could not open options modal');
                }
                if (hasOptionsList) {
                    const liCount = await newPage.$$eval('li.TpUpcNRp', els => els.length).catch(() => 0);
                    const cardCount = await newPage.$$eval('div._8gg8ho2u', els => els.length).catch(() => 0);
                    console.log(`[PDD] Options elements found: li.TpUpcNRp=${liCount}, div._8gg8ho2u=${cardCount}`);
                } else {
                    console.log('[PDD] Options list not found; continuing without selecting any options');
                }

                await waitForStableUrl(newPage, 1400, 15000);

                const data = await safeEvaluate(newPage, async () => {
                    const wait = (ms) => new Promise(r => setTimeout(r, ms));
                    
                    // HELPER: Strict Price Extraction from User Target
                    const getTargetPrice = (root) => {
                         const r = (root && typeof root.querySelector === 'function') ? root : document;
                         const targetDiv = r.querySelector('.ujEqGzEB') || document.querySelector('.ujEqGzEB');
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

                         const altPriceEl =
                            r.querySelector('div.kYzukoxf') ||
                            r.querySelector('.Ngfn6pTR .kYzukoxf') ||
                            document.querySelector('div.kYzukoxf') ||
                            document.querySelector('.Ngfn6pTR .kYzukoxf');
                         if (altPriceEl) {
                             const text = altPriceEl.innerText.replace(/\n/g, ' ').trim();
                             const match = text.match(/¥\s*(\d+(\.\d+)?)/);
                             if (match) return match[0];
                         }

                         return null;
                    };

                    const waitForPriceAfterClick = async (prevPriceStr, root) => {
                        const start = Date.now();
                        let last = null;
                        let stable = 0;
                        while (Date.now() - start < 7000) {
                            const cur = getTargetPrice(root);
                            if (cur) {
                                if (cur === last) stable++;
                                else {
                                    last = cur;
                                    stable = 0;
                                }
                                const changed = prevPriceStr ? (cur !== prevPriceStr) : true;
                                if (changed && stable >= 1) return cur;
                                if (!prevPriceStr && stable >= 1) return cur;
                            }
                            await wait(120);
                        }
                        return getTargetPrice(root) || last || null;
                    };

                    // 1. Title Extraction (User specific selector)
                    let title = '';
                    const titleEl = document.querySelector('.tLYIg_Ju span') || 
                                   document.querySelector('.KlGVpw3u span') ||
                                   document.querySelector('.goods-name');
                    if (titleEl) title = titleEl.innerText.trim();
                    if (!title) title = document.title;

                    // 2. Price Extraction (Initial fallback)
                     let price = getTargetPrice(document);
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
                    let skuThumbMap = {}; // Map optionKey -> imageUrl (per SKU or per single option)
                    let lowestVariantPrice = null; // Track lowest price found in variants

                    try {
                        const extractOptionCardsFromRoot = () => {
                            const liEls = Array.from(document.querySelectorAll('li.TpUpcNRp'));
                            const containerEls = liEls.length > 0
                                ? liEls.map(li => li.querySelector('div._8gg8ho2u') || li).filter(Boolean)
                                : Array.from(document.querySelectorAll('div._8gg8ho2u'));
                            const items = [];
                            const seen = new Set();

                            for (const c of containerEls) {
                                const nameEl = c?.querySelector?.('.RITrraU3 span.U63Kdv8C') || c?.querySelector?.('.RITrraU3 span') || c?.querySelector?.('span.U63Kdv8C');
                                const textRaw = nameEl?.innerText || nameEl?.textContent || '';
                                const text = String(textRaw || '').replace(/\s+/g, ' ').trim();

                                const priceEl = c?.querySelector?.('.nvN5jV0G') || c?.querySelector?.('[class*="nvN5jV0G"]');
                                const priceRaw = priceEl?.innerText || priceEl?.textContent || '';
                                const pm = String(priceRaw || '').match(/(\d+(\.\d+)?)/);
                                const priceStr = pm ? (`¥${pm[1]}`) : null;

                                const imgEl =
                                    c.querySelector('.PQoZYCec img') ||
                                    c.querySelector('.PQoZYCec img[data-src]') ||
                                    c.querySelector('.PQoZYCec img[data-lazy-src]') ||
                                    c.querySelector('.PQoZYCec img[data-original]') ||
                                    c.querySelector('img');
                                const rawSrc =
                                    imgEl?.getAttribute('src') ||
                                    imgEl?.getAttribute('data-src') ||
                                    imgEl?.getAttribute('data-lazy-src') ||
                                    imgEl?.getAttribute('data-original') ||
                                    imgEl?.src ||
                                    '';
                                let thumb = rawSrc ? rawSrc.split('?')[0] : null;
                                if (!thumb) {
                                    const pq = c.querySelector('.PQoZYCec') || c;
                                    const styleBg = pq?.style?.backgroundImage || '';
                                    let bg = styleBg;
                                    if (!bg) {
                                        try { bg = window.getComputedStyle(pq).backgroundImage || ''; } catch (e) {}
                                    }
                                    const m = String(bg || '').match(/url\((['"]?)(.*?)\1\)/i);
                                    const url = m?.[2] || '';
                                    thumb = url ? url.split('?')[0] : null;
                                }

                                if (text && priceStr) {
                                    const k = `${text}||${priceStr}||${thumb || ''}`;
                                    if (seen.has(k)) continue;
                                    seen.add(k);
                                    items.push({ text, priceStr, thumb });
                                }
                            }

                            return items;
                        };

                        const cardsOnPage = extractOptionCardsFromRoot();
                        if (cardsOnPage.length > 0) {
                            for (const card of cardsOnPage) {
                                skuMap[card.text] = card.priceStr;
                                if (card.thumb) skuThumbMap[card.text] = card.thumb;
                            }
                        }

                        const modal = document.querySelector('.HidQ9ROd') || document.querySelector('div[role="dialog"][aria-modal="true"]') || document.querySelector('div[role="dialog"]');
                        if (modal) {
                                const waitForOptionCards = async (timeoutMs = 2500) => {
                                    const start = Date.now();
                                    while (Date.now() - start < timeoutMs) {
                                        const hasLi = document.querySelectorAll('li.TpUpcNRp').length > 0;
                                        const hasCards = document.querySelectorAll('div._8gg8ho2u').length > 0;
                                        if (hasLi || hasCards) return true;
                                        await wait(120);
                                    }
                                    return false;
                                };

                                const host = modal.querySelector('.O7pEFvHR');
                                if (host) {
                                    try {
                                        host.scrollIntoView({ block: 'center', inline: 'center' });
                                    } catch (e) {}
                                    try {
                                        host.click();
                                    } catch (e) {}
                                    await waitForOptionCards(3000);
                                    const cardsAfterHostClick = extractOptionCardsFromRoot();
                                    if (cardsAfterHostClick.length > 0) {
                                        for (const card of cardsAfterHostClick) {
                                            skuMap[card.text] = card.priceStr;
                                            if (card.thumb) skuThumbMap[card.text] = card.thumb;
                                        }
                                    }
                                }

                                const getModalThumb = () => {
                                    const img = modal.querySelector('.O7pEFvHR img');
                                    const raw =
                                        img?.getAttribute?.('src') ||
                                        img?.getAttribute?.('data-src') ||
                                        img?.getAttribute?.('data-lazy-src') ||
                                        img?.currentSrc ||
                                        img?.src ||
                                        '';
                                    if (raw) return String(raw).split('?')[0];

                                    const host = modal.querySelector('.O7pEFvHR');
                                    if (host) {
                                        const styleBg = host.style?.backgroundImage || '';
                                        let bg = styleBg;
                                        if (!bg) {
                                            try { bg = window.getComputedStyle(host).backgroundImage || ''; } catch (e) {}
                                        }
                                        const m = String(bg || '').match(/url\((['"]?)(.*?)\1\)/i);
                                        const url = m?.[2] || '';
                                        if (url) return url.split('?')[0];
                                    }
                                    return null;
                                };

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

                                const isDisabledOption = (el) => {
                                    if (!el) return true;
                                    const ariaDisabled = el.getAttribute('aria-disabled');
                                    if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return true;
                                    if (el.hasAttribute('disabled')) return true;
                                    const cls = String(el.className || '').toLowerCase();
                                    if (cls.includes('disabled')) return true;
                                    return false;
                                };

                                const getOptionText = (el) => {
                                    return el?.querySelector('span.J109_25J')?.innerText.trim() || el?.innerText.trim() || '';
                                };

                                const safeClick = async (el) => {
                                    if (!el) return false;
                                    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch(e) {}
                                    try { el.click(); return true; } catch(e) {}
                                    try {
                                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                        return true;
                                    } catch(e) {}
                                    return false;
                                };

                                const getGroupOptions = (groupEl) => {
                                    const valContainer = groupEl?.querySelector('.s1O5M5fO');
                                    if (!valContainer) return [];
                                    return Array.from(valContainer.querySelectorAll('.F7sZG3xe'))
                                        .map(el => ({ text: getOptionText(el), element: el }))
                                        .filter(v => v.text && !isDisabledOption(v.element));
                                };

                                const getGroup1 = () => Array.from(modal.querySelectorAll('.bIhLWVqm'))[0] || null;
                                const getGroup2 = () => Array.from(modal.querySelectorAll('.bIhLWVqm'))[1] || null;

                                const isSelectedOption = (el) => {
                                    if (!el) return false;
                                    const clsRaw = String(el.className || '');
                                    const cls = clsRaw.toLowerCase();
                                    if (cls.includes('hr353bdx')) return true;
                                    if (cls.includes('kv0lnch3')) return true;
                                    const ariaChecked = el.getAttribute('aria-checked');
                                    if (ariaChecked && ariaChecked.toLowerCase() === 'true') return true;
                                    const ariaSelected = el.getAttribute('aria-selected');
                                    if (ariaSelected && ariaSelected.toLowerCase() === 'true') return true;
                                    const ariaPressed = el.getAttribute('aria-pressed');
                                    if (ariaPressed && ariaPressed.toLowerCase() === 'true') return true;
                                    const dataState = el.getAttribute('data-state');
                                    if (dataState && (dataState === 'checked' || dataState === 'selected')) return true;
                                    const dataSelected = el.getAttribute('data-selected');
                                    if (dataSelected && dataSelected.toLowerCase() === 'true') return true;
                                    if (el.querySelector && el.querySelector('[aria-checked="true"], [aria-selected="true"]')) return true;
                                    if (cls.includes('selected') || cls.includes('active') || cls.includes('checked') || cls.includes('current') || cls.includes('cur') || cls.includes('on')) return true;
                                    return false;
                                };

                                const getGroupOptionElements = (groupEl) => {
                                    const valContainer = groupEl?.querySelector('.s1O5M5fO');
                                    if (!valContainer) return [];
                                    return Array.from(valContainer.querySelectorAll('.F7sZG3xe'))
                                        .filter(el => !isDisabledOption(el) && !!getOptionText(el));
                                };

                                const getOptionStyleKey = (el) => {
                                    try {
                                        const s = window.getComputedStyle(el);
                                        const bg = s.backgroundColor || '';
                                        const border = s.borderColor || '';
                                        const color = s.color || '';
                                        const fw = s.fontWeight || '';
                                        const outline = s.outlineColor || '';
                                        return `${bg}|${border}|${color}|${fw}|${outline}`;
                                    } catch (e) {
                                        return '';
                                    }
                                };

                                const getSelectedOptionEl = (groupEl) => {
                                    const optionEls = getGroupOptionElements(groupEl);
                                    if (optionEls.length === 0) return null;

                                    const ariaSelectedEl = optionEls.find(isSelectedOption) || null;
                                    if (ariaSelectedEl) return ariaSelectedEl;

                                    const keyCounts = new Map();
                                    for (const el of optionEls) {
                                        const key = getOptionStyleKey(el);
                                        keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
                                    }

                                    let bestEl = null;
                                    let bestCount = Infinity;
                                    for (const el of optionEls) {
                                        const key = getOptionStyleKey(el);
                                        const c = keyCounts.get(key) || 0;
                                        if (c > 0 && c < bestCount) {
                                            bestCount = c;
                                            bestEl = el;
                                        }
                                    }

                                    if (bestEl && bestCount < optionEls.length) return bestEl;
                                    return null;
                                };

                                const getSelectedOptionText = (groupEl) => {
                                    const selectedEl = getSelectedOptionEl(groupEl);
                                    return selectedEl ? getOptionText(selectedEl) : null;
                                };

                                const findOptionElByText = (groupEl, text) => {
                                    if (!groupEl) return null;
                                    const valContainer = groupEl.querySelector('.s1O5M5fO');
                                    if (!valContainer) return null;
                                    const optionEls = Array.from(valContainer.querySelectorAll('.F7sZG3xe'));
                                    for (const el of optionEls) {
                                        if (isDisabledOption(el)) continue;
                                        if (getOptionText(el) === text) return el;
                                    }
                                    return null;
                                };

                                const waitFor = async (predicate, timeoutMs = 2500, intervalMs = 120) => {
                                    const start = Date.now();
                                    while (Date.now() - start < timeoutMs) {
                                        try {
                                            if (predicate()) return true;
                                        } catch (e) {}
                                        await wait(intervalMs);
                                    }
                                    return false;
                                };

                                const waitForStableTargetPrice = async (root, timeoutMs = 5000, intervalMs = 150, stableTicks = 2) => {
                                    const start = Date.now();
                                    let last = null;
                                    let stable = 0;
                                    while (Date.now() - start < timeoutMs) {
                                        const cur = getTargetPrice(root);
                                        if (cur) {
                                            if (cur === last) stable++;
                                            else {
                                                last = cur;
                                                stable = 0;
                                            }
                                            if (stable >= stableTicks) return cur;
                                        }
                                        await wait(intervalMs);
                                    }
                                    return getTargetPrice(root) || last || null;
                                };

                                const waitForStableModalThumb = async (prevThumb, timeoutMs = 5000, intervalMs = 150, stableTicks = 2) => {
                                    const start = Date.now();
                                    let last = getModalThumb();
                                    let stable = 0;
                                    while (Date.now() - start < timeoutMs) {
                                        const cur = getModalThumb();
                                        if (cur) {
                                            if (cur !== last) {
                                                last = cur;
                                                stable = 0;
                                            } else {
                                                stable++;
                                            }
                                            if (prevThumb && cur !== prevThumb && stable >= stableTicks) return cur;
                                            if (!prevThumb && stable >= stableTicks) return cur;
                                        }
                                        await wait(intervalMs);
                                    }
                                    return getModalThumb() || last || null;
                                };

                                const recordSku = (key, priceStr, thumb) => {
                                    if (!key || !priceStr) return;
                                    skuMap[key] = priceStr;
                                    if (thumb) {
                                        skuThumbMap[key] = thumb;
                                    }
                                    const pMatch = String(priceStr || '').match(/(\d+(\.\d+)?)/);
                                    if (pMatch) {
                                        const pVal = parseFloat(pMatch[1]);
                                        if (Number.isFinite(pVal)) {
                                            if (lowestVariantPrice === null || pVal < lowestVariantPrice) {
                                                lowestVariantPrice = pVal;
                                                price = `¥${pMatch[1]}`;
                                            }
                                        }
                                    }
                                };

                                if (Object.keys(skuMap).length === 0 && Array.isArray(specValues) && specValues.length > 0) {
                                    const startedAt = Date.now();
                                    const timeBudgetMs = 65000;
                                    const group1 = specValues[0] || [];
                                    const group2 = specValues[1] || [];
                                    const group1Opts = group1.filter(v => v?.text && v?.element && !isDisabledOption(v.element));
                                    const group2Opts = group2.filter(v => v?.text && v?.element && !isDisabledOption(v.element));

                                    if (group1Opts.length > 0 && group2Opts.length === 0) {
                                        for (const o1 of group1Opts) {
                                            if (Date.now() - startedAt > timeBudgetMs) break;
                                            const prevPrice = getTargetPrice(document);
                                            const prevThumb = getModalThumb();
                                            await safeClick(o1.element);
                                            await wait(180);
                                            const priceStr = await waitForPriceAfterClick(prevPrice, document);
                                            const thumb = await waitForStableModalThumb(prevThumb, 4500, 160, 2);
                                            if (thumb) variantImages[o1.text] = thumb;
                                            recordSku(o1.text, priceStr || prevPrice || priceStr, thumb);
                                        }
                                    } else if (group1Opts.length > 0 && group2Opts.length > 0) {
                                        for (const o1 of group1Opts) {
                                            if (Date.now() - startedAt > timeBudgetMs) break;
                                            const prevThumbColor = getModalThumb();
                                            await safeClick(o1.element);
                                            await wait(220);
                                            const colorThumb = await waitForStableModalThumb(prevThumbColor, 4500, 160, 2);
                                            if (colorThumb) variantImages[o1.text] = colorThumb;

                                            for (const o2 of group2Opts) {
                                                if (Date.now() - startedAt > timeBudgetMs) break;
                                                const prevPrice = getTargetPrice(document);
                                                const prevThumb = getModalThumb();
                                                await safeClick(o2.element);
                                                await wait(200);
                                                const priceStr = await waitForPriceAfterClick(prevPrice, document);
                                                const thumb = await waitForStableModalThumb(prevThumb, 4500, 160, 2);
                                                const key = `${o1.text}__SEP__${o2.text}`;
                                                recordSku(key, priceStr || prevPrice || priceStr, thumb || colorThumb);
                                            }
                                        }
                                    }
                                }

                                const extractCardTextPrice = (c) => {
                                    const nameEl = c?.querySelector?.('.RITrraU3 span.U63Kdv8C') || c?.querySelector?.('.RITrraU3 span') || c?.querySelector?.('span.U63Kdv8C');
                                    let textRaw = nameEl?.innerText || nameEl?.textContent || '';
                                    let text = String(textRaw || '').replace(/\s+/g, ' ').trim();
                                    if (!text) {
                                        const spans = Array.from(c?.querySelectorAll?.('span') || []);
                                        for (const s of spans) {
                                            const t = String(s?.innerText || s?.textContent || '').replace(/\s+/g, ' ').trim();
                                            if (!t) continue;
                                            if (t.includes('¥') || t.includes('￥')) continue;
                                            if (t.includes('已选') || t.includes('请选择')) continue;
                                            if (t.length > 80) continue;
                                            text = t;
                                            break;
                                        }
                                    }

                                    const priceEl = c?.querySelector?.('.nvN5jV0G') || c?.querySelector?.('[class*="nvN5jV0G"]');
                                    let priceRaw = priceEl?.innerText || priceEl?.textContent || '';
                                    if (!priceRaw) {
                                        const t = String(c?.innerText || c?.textContent || '');
                                        const m = t.match(/[¥￥]\s*(\d+(\.\d+)?)/);
                                        if (m) priceRaw = m[0];
                                    }
                                    const pm = String(priceRaw || '').match(/(\d+(\.\d+)?)/);
                                    const priceStr = pm ? (`¥${pm[1]}`) : null;

                                    return { text, priceStr };
                                };

                                const extractCardThumb = (c) => {
                                    const imgEl = c.querySelector('.PQoZYCec img') || c.querySelector('.PQoZYCec img[data-src]') || c.querySelector('.PQoZYCec img[data-lazy-src]') || c.querySelector('.PQoZYCec img[data-original]') || c.querySelector('img');
                                    const rawSrc =
                                        imgEl?.getAttribute('src') ||
                                        imgEl?.getAttribute('data-src') ||
                                        imgEl?.getAttribute('data-lazy-src') ||
                                        imgEl?.getAttribute('data-original') ||
                                        imgEl?.src ||
                                        '';
                                    if (rawSrc) return rawSrc.split('?')[0];

                                    const pq = c.querySelector('.PQoZYCec') || c;
                                    const styleBg = pq?.style?.backgroundImage || '';
                                    let bg = styleBg;
                                    if (!bg) {
                                        try { bg = window.getComputedStyle(pq).backgroundImage || ''; } catch (e) {}
                                    }
                                    const m = String(bg || '').match(/url\((['"]?)(.*?)\1\)/i);
                                    const url = m?.[2] || '';
                                    return url ? url.split('?')[0] : null;
                                };

                                const scanThumbsViaO7pEFvHR = async (group1Texts, group2Texts, maxSwipes = 28) => {
                                    const out = {};
                                    const seenKeys = new Set();
                                    const host = modal.querySelector('.O7pEFvHR') || modal.querySelector('.O7pEFvHR img');
                                    if (!host) return out;

                                    const getSelectedSummaryText = () => {
                                        const el = modal.querySelector('.xJDS9NLo .Mbx2m60G') || modal.querySelector('.Mbx2m60G');
                                        const t = el?.innerText || el?.textContent || '';
                                        return String(t || '').replace(/\s+/g, ' ').trim();
                                    };

                                    const normalizeSelectedSummary = (t) => {
                                        return String(t || '').replace(/^已选\s*[:：]\s*/g, '').trim();
                                    };

                                    const pickComboKey = (summary) => {
                                        const s = String(summary || '');
                                        const v1 = (group1Texts || []).find(t => t && s.includes(t)) || null;
                                        const v2 = (group2Texts || []).find(t => t && s.includes(t)) || null;
                                        if (v1 && v2) return `${v1}__SEP__${v2}`;
                                        return summary || null;
                                    };

                                    const swipeLeft = async () => {
                                        try {
                                            const r = host.getBoundingClientRect();
                                            const startX = Math.floor(r.left + r.width * 0.78);
                                            const endX = Math.floor(r.left + r.width * 0.22);
                                            const y = Math.floor(r.top + r.height * 0.5);
                                            const touchStart = new Touch({ identifier: Date.now(), target: host, clientX: startX, clientY: y });
                                            const touchEnd = new Touch({ identifier: Date.now(), target: host, clientX: endX, clientY: y });
                                            host.dispatchEvent(new TouchEvent('touchstart', { touches: [touchStart], bubbles: true }));
                                            host.dispatchEvent(new TouchEvent('touchmove', { touches: [touchEnd], bubbles: true }));
                                            host.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touchEnd], bubbles: true }));
                                            await wait(380);
                                            return true;
                                        } catch (e) {
                                            try {
                                                const r = host.getBoundingClientRect();
                                                const startX = Math.floor(r.left + r.width * 0.78);
                                                const endX = Math.floor(r.left + r.width * 0.22);
                                                const y = Math.floor(r.top + r.height * 0.5);
                                                host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: y }));
                                                host.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: endX, clientY: y }));
                                                host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: endX, clientY: y }));
                                                await wait(380);
                                                return true;
                                            } catch (e2) {}
                                        }
                                        return false;
                                    };

                                    let stagnation = 0;
                                    let lastKey = null;
                                    for (let i = 0; i < maxSwipes; i++) {
                                        const summary = normalizeSelectedSummary(getSelectedSummaryText());
                                        const key = pickComboKey(summary);
                                        const thumb = getModalThumb();
                                        if (key && thumb) out[key] = thumb;

                                        if (key && key === lastKey) stagnation++;
                                        else stagnation = 0;
                                        lastKey = key || lastKey;

                                        if (key) seenKeys.add(key);
                                        if (seenKeys.size >= 6 && stagnation >= 2) break;

                                        const didSwipe = await swipeLeft();
                                        if (!didSwipe) break;
                                    }

                                    return out;
                                };

                                const extractOptionCards = (root) => {
                                    const scope = (root || document);
                                    const liEls = Array.from(scope.querySelectorAll('li.TpUpcNRp'));
                                    const containerEls = liEls.length > 0
                                        ? liEls.map(li => li.querySelector('div._8gg8ho2u')).filter(Boolean)
                                        : Array.from(scope.querySelectorAll('div._8gg8ho2u'));
                                    const items = [];
                                    const seen = new Set();
                                    const addFromContainer = (c) => {
                                        const thumb = extractCardThumb(c);
                                        const { text, priceStr } = extractCardTextPrice(c);

                                        if (text && priceStr) {
                                            const k = `${text}||${priceStr}||${thumb || ''}`;
                                            if (seen.has(k)) return;
                                            seen.add(k);
                                            items.push({ text, priceStr, thumb });
                                        }
                                    };

                                    for (const c of containerEls) addFromContainer(c);

                                    if (items.length === 0) {
                                        const priceEls = Array.from(scope.querySelectorAll('.nvN5jV0G, [class*="nvN5jV0G"]'));
                                        const candidates = [];
                                        const uniq = new Set();
                                        for (const p of priceEls) {
                                            const t = String(p?.innerText || p?.textContent || '').replace(/\s+/g, ' ').trim();
                                            if (!t || (!t.includes('¥') && !t.includes('￥'))) continue;
                                            const c = p.closest('li') || p.closest('div') || p.parentElement;
                                            if (!c) continue;
                                            const key = c === scope ? null : (c.getAttribute?.('class') || '') + '::' + (c.innerText || '').slice(0, 60);
                                            if (key && uniq.has(key)) continue;
                                            if (key) uniq.add(key);
                                            candidates.push(c);
                                            if (candidates.length >= 40) break;
                                        }
                                        for (const c of candidates) addFromContainer(c);
                                    }

                                    return items;
                                };

                                const cards = extractOptionCards(modal);
                                if (cards.length > 0) {
                                    for (const card of cards) {
                                        skuMap[card.text] = card.priceStr;
                                        if (card.thumb) skuThumbMap[card.text] = card.thumb;

                                        const pMatch = card.priceStr.match(/(\d+(\.\d+)?)/);
                                        if (pMatch) {
                                            const pVal = parseFloat(pMatch[1]);
                                            if (lowestVariantPrice === null || pVal < lowestVariantPrice) {
                                                lowestVariantPrice = pVal;
                                                price = card.priceStr;
                                            }
                                        }
                                    }
                                }
                        }
                    } catch (e) {
                        console.log('Variant extraction failed:', e.message);
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
                     await wait(5000);
                     try {
                         for (let i = 0; i < 2; i++) {
                             const x = Math.floor(window.innerWidth / 2);
                             const y = 12;
                             const el = document.elementFromPoint(x, y);
                             if (el) el.click();
                             await wait(220);
                         }
                         const backBtn = document.querySelector('div[role="button"][aria-label*="返回"]') ||
                             document.querySelector('div[role="button"][aria-label*="后退"]') ||
                             document.querySelector('div[role="button"][aria-label*="关闭"]');
                         if (backBtn) {
                             backBtn.click();
                             await wait(600);
                         }
                     } catch (e) {}
                     await wait(10000);

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
                     // Priority 1: User-identified container "Blmqu2TV"
                     const blmContainer = document.querySelector('.Blmqu2TV') || document.querySelector('div[class*="Blmqu2TV"]');
                     let foundDescImages = false;

                     if (blmContainer) {
                         console.log('[PDD] Found Blmqu2TV container for description images');
                         const imgs = Array.from(blmContainer.querySelectorAll('img'));
                         
                         imgs.forEach(img => {
                             // STRICT EXCLUSION
                             if (img.closest('a[href*="goods_id"]')) return;
                             if (img.closest('.recommend-goods')) return;

                             // User provided example: data-src is primary
                             let src = img.getAttribute('data-src') || img.getAttribute('src') || img.src;
                             
                             if (src && !src.startsWith('data:')) {
                                 src = src.split('?')[0];
                                 if (src.startsWith('//')) src = 'https:' + src;
                                 
                                 if (src.startsWith('http') && !src.includes('avatar') && !src.includes('icon') && !src.includes('video-snapshot') && !src.includes('coupon') && !src.includes('.slim.png')) {
                                      // Optional: Check for size if possible, but data-src usually implies main content
                                      product_desc_imgs.push(src);
                                 }
                             }
                         });
                         
                         if (product_desc_imgs.length > 0) foundDescImages = true;
                     }

                     // Priority 2: Old strict selector if Blmqu2TV failed
                     if (!foundDescImages) {
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
                             if (product_desc_imgs.length > 0) foundDescImages = true;
                         } 
                     }
                     
                     if (!foundDescImages) {
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

                    return { title, price, description, images: [...new Set(images)], variants, skuMap, skuThumbMap, productDetails, product_desc_imgs: [...new Set(product_desc_imgs)], variantImages };
                }, [], 12);

                // Enrich
                console.log(`Enriching: ${data.title.substring(0, 20)}...`);
                
                let general_price = 0;
                if (data.price) {
                     const match = data.price.match(/(\d+(\.\d+)?)/);
                     if (match) general_price = parseFloat(match[1]) * 200; 
                }

                // --- EDIBLE CHECK (KEYWORD PRE-FILTER) ---
                const preCheck = isEdiblePreCheck(data.title, data.description);
                if (preCheck.isEdible) {
                    console.log(`Skipping product (EDIBLE KEYWORD DETECTED: ${preCheck.keyword}): ${data.title.substring(0, 30)}...`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                const aiData = await enrichWithAI(data.title, data.description, data.price);

                // CHECK: Did AI fail completely?
                if (aiData.shouldSkip) {
                    console.error(`Skipping product due to AI translation failure: ${aiData.reason}`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                // CHECK: Is it edible (AI Detection)?
                if (aiData.is_edible) {
                    console.log(`Skipping product (AI DETECTED EDIBLE): ${data.title.substring(0, 30)}...`);
                    if (!navigationHappened) await newPage.close();
                    else await newPage.goBack();
                    continue;
                }

                // --- GENERATE OPTIONS FROM SKU MAP (WITH TRANSLATION) ---
                let generated_options = [];
                const variantImages = data.variantImages || {};
                const skuThumbMap = data.skuThumbMap || {};

                if (data.skuMap && Object.keys(data.skuMap).length > 0) {
                    const rawVariantEntries = Object.entries(data.skuMap || {});
                    console.log(`Variant prices BEFORE translation (${rawVariantEntries.length})`);
                    const rawPreviewLimit = 80;
                    rawVariantEntries.slice(0, rawPreviewLimit).forEach(([k, v]) => {
                        const m = String(v || '').match(/(\d+(\.\d+)?)/);
                        const p = m ? Math.round(parseFloat(m[1]) * 200) : 0;
                        console.log(`  ${k} => ${v} (${p} IQD)`);
                    });
                    if (rawVariantEntries.length > rawPreviewLimit) {
                        console.log(`  ... truncated ${rawVariantEntries.length - rawPreviewLimit} more`);
                    }
                    
                    // Helper to translate color/size via AI if possible, or simple mapping
                    // Since we want strict Arabic, we might need a quick AI pass or just use the aiData logic
                    // For now, let's process the structure first, then maybe translate the labels

                    const resolveThumbnail = (optionKey, colorStr) => {
                        if (optionKey && skuThumbMap[optionKey]) return skuThumbMap[optionKey];
                        if (!colorStr) return null;
                        if (variantImages[colorStr]) return variantImages[colorStr];
                        const keys = Object.keys(variantImages || {});
                        const matchingKey = keys.find(k => k && (k.includes(colorStr) || colorStr.includes(k)));
                        return matchingKey ? variantImages[matchingKey] : null;
                    };

                    for (const [key, priceStr] of rawVariantEntries) {
                        let color = key;
                        let size = null;

                        if (key.includes('__SEP__')) {
                            const parts = key.split('__SEP__');
                            color = parts[0];
                            size = parts[1];
                        }

                        let priceVal = 0;
                        const match = String(priceStr || '').match(/(\d+(\.\d+)?)/);
                        if (match) priceVal = parseFloat(match[1]) * 200;

                        color = String(color || '')
                            .replace(/\n.*$/, '')
                            .replace(/【.*?】/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();

                        if (size) {
                            size = String(size || '');
                            size = size.replace(/(\d+(\.\d+)?)\s*[-~]\s*(\d+(\.\d+)?)\s*斤/g, (m, p1, p2, p3) => {
                                const start = parseFloat(p1) / 2;
                                const end = parseFloat(p3) / 2;
                                return `${start}-${end}kg`;
                            });
                            size = size.replace(/(\d+(\.\d+)?)\s*斤/g, (m, p1) => `${parseFloat(p1) / 2}kg`);
                            size = size.replace(/\n.*$/, '').replace(/【.*?】/g, '').replace(/\s+/g, ' ').trim();
                            if (!size) size = null;
                        }

                        generated_options.push({
                            color,
                            sizes: size ? [size] : [],
                            price: priceVal,
                            thumbnail: resolveThumbnail(key, color)
                        });
                    }

                    console.log(`Generated options from SKU map (${generated_options.length})`);
 
                     // --- TRANSLATE OPTIONS IF AI IS AVAILABLE ---
                     if (aiClient && generated_options.length > 0) {
                         console.log(`Translating ${generated_options.length} options via AI (chunked)...`);

                         const translateChunk = async (chunk) => {
                             const optionsText = JSON.stringify(chunk.map(o => ({ c: o.color, s: (o.sizes && o.sizes[0]) ? o.sizes[0] : "" })));
                             const transPrompt = `
                             Translate these product options to Arabic.
                             Input: ${optionsText}
                             
                             IMPORTANT:
                             - Return ONLY a JSON array. Do not include any conversational text like "Here is the JSON" or markdown code blocks.
                             - Keep the number of items EXACTLY the same as input.
                             - Keep the order EXACTLY the same as input.
                             - Each output item must be {"c": "...", "s": "..."}.
                             - If the input contains "kg" (kilograms), KEEP "kg" in the translation (e.g. "80kg" -> "80kg" or "80 كغم").
                             - Do NOT convert numbers back to original units.
                             - Remove any Chinese characters or marketing text like "快要断码", "图片色" (Image Color), "高质量", "建议", "斤".
                             - "图片色" or "默认" should be translated as "كما في الصورة" (As shown in image) or "اللون الافتراضي" (Default Color).
                             - Remove any newlines or extra whitespace.
                             - Return pure, clean Arabic names for colors and sizes.
                             - TRANSLATE COLORS TO ARABIC (e.g. "Black" -> "أسود", "红色" -> "أحمر").
                             - TRANSLATE "建议" (Recommended) to "مقترح" or remove it if just a label.
                             - STRICTLY REMOVE any "return policy", "refund", "replacement" (e.g. "包退", "包换") text from option names.
                             `;

                             const translate = async (model) => {
                                 return await aiClient.chat.completions.create({
                                     model,
                                     messages: [{ role: "user", content: transPrompt }],
                                     temperature: 0.3,
                                     max_tokens: 2048
                                 });
                             };

                             let transRes;
                             try {
                                transRes = await translate(AI_PRIMARY_MODEL);
                            } catch (e) {
                                if (isTimeoutError(e)) {
                                    throw e;
                                }
                                if (isModelBusyError(e)) {
                                    console.log(`AI busy on ${AI_PRIMARY_MODEL}. Falling back to ${AI_BUSY_FALLBACK_MODEL} for options translation...`);
                                    transRes = await translate(AI_BUSY_FALLBACK_MODEL);
                                } else if (AI_FALLBACK_MODEL && AI_FALLBACK_MODEL !== AI_PRIMARY_MODEL) {
                                    console.log(`AI error on ${AI_PRIMARY_MODEL}. Falling back to ${AI_FALLBACK_MODEL} for options translation...`);
                                    transRes = await translate(AI_FALLBACK_MODEL);
                                } else {
                                    throw e;
                                }
                            }

                             let transJson = transRes.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
                             const startIdx = transJson.indexOf('[');
                             const endIdx = transJson.lastIndexOf(']');
                             if (startIdx !== -1 && endIdx !== -1) transJson = transJson.substring(startIdx, endIdx + 1);

                             const transArr = JSON.parse(transJson);
                             if (!Array.isArray(transArr) || transArr.length !== chunk.length) {
                                 throw new Error(`Translation length mismatch (${Array.isArray(transArr) ? transArr.length : 'invalid'} vs ${chunk.length})`);
                             }
                             return transArr;
                         };

                         const applyTranslation = (chunk, transArr) => {
                             for (let i = 0; i < chunk.length; i++) {
                                 const opt = chunk[i];
                                 const t = transArr[i] || {};
                                 if (t.c) opt.color = String(t.c).trim().replace(/\s+/g, ' ');
                                 if (Array.isArray(opt.sizes) && opt.sizes.length > 0) {
                                     if (t.s !== undefined && t.s !== null) {
                                         const nextSize = String(t.s).trim().replace(/\s+/g, ' ');
                                         if (nextSize) opt.sizes[0] = nextSize;
                                     }
                                 }
                             }
                         };

                         const baseChunkSize = Number(process.env.AI_OPTIONS_TRANSLATE_CHUNK_SIZE) > 0 ? Number(process.env.AI_OPTIONS_TRANSLATE_CHUNK_SIZE) : 25;
                         const queue = [];
                         for (let i = 0; i < generated_options.length; i += baseChunkSize) {
                             queue.push([i, Math.min(i + baseChunkSize, generated_options.length)]);
                         }

                         while (queue.length > 0) {
                             const [start, end] = queue.shift();
                             const chunk = generated_options.slice(start, end);
                             let ok = false;
                             let attempts = 0;
                             const maxAttempts = 3;
                             while (!ok && attempts < maxAttempts) {
                                 attempts++;
                                 try {
                                     const transArr = await translateChunk(chunk);
                                     applyTranslation(chunk, transArr);
                                     ok = true;
                                 } catch (e) {
                                     if (attempts >= maxAttempts) break;
                                     await delay(700);
                                 }
                             }
                             if (!ok) {
                                 if (chunk.length <= 1) continue;
                                 const mid = start + Math.floor((end - start) / 2);
                                 queue.unshift([mid, end]);
                                 queue.unshift([start, mid]);
                             }
                         }

                         console.log('Options translation applied (chunked best-effort).');
                     } else {
                         console.log('Skipping options translation (AI not ready or no options).');
                     }

                    console.log(`Variant prices AFTER translation (${generated_options.length})`);
                    const postLines = [];
                    for (const opt of generated_options) {
                        const s = (opt.sizes && opt.sizes[0]) ? opt.sizes[0] : '';
                        postLines.push(`${opt.color}${s ? `__SEP__${s}` : ''} => ${opt.price} IQD`);
                    }
                    const postPreviewLimit = 120;
                    postLines.slice(0, postPreviewLimit).forEach(l => console.log(`  ${l}`));
                    if (postLines.length > postPreviewLimit) console.log(`  ... truncated ${postLines.length - postPreviewLimit} more`);
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

                        if (hasInvalidKeyword) {
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
                                    sizes.add(s);
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
                    const normalizeVariantBasePrice = (basePrice) => {
                        let p = Number(basePrice) || 0;
                        if (p > 0 && p < 100) {
                            console.log(`Warning: Suspiciously low price (${p}). Assuming RMB and multiplying by 200.`);
                            p = p * 200;
                        } else if (p > 0 && p < 1000 && enrichedProduct.general_price > 5000) {
                            console.log(`Warning: Variant price ${p} vs Main ${enrichedProduct.general_price}. Assuming RMB.`);
                            p = p * 200;
                        }
                        return p;
                    };
                    for (const opt of enrichedProduct.generated_options) {
                        // SKIP if color is Chinese (DISABLED: User wants to keep them)
                        // if (containsChinese(opt.color)) continue;

                        const color = opt.color;
                        const fallbackBasePrice = normalizeVariantBasePrice(opt.price || enrichedProduct.general_price || 0);
                        const variantImg = opt.thumbnail || enrichedProduct.main_images[0] || '';
                        
                        if (opt.sizes && Array.isArray(opt.sizes) && opt.sizes.length > 0) {
                            for (const size of opt.sizes) {
                                const variantBasePrice = fallbackBasePrice;
                                const variantFinalPrice = calculateFinalPrice(variantBasePrice);
                                const combinationObj = {
                                    "اللون": color,
                                    "المقاس": size
                                };
                                variantsData.push({
                                    productId: newProduct.id,
                                    combination: JSON.stringify(combinationObj),
                                    price: variantFinalPrice,
                                    basePriceIQD: variantBasePrice,
                                    image: variantImg
                                });
                            }
                        } else {
                            const variantBasePrice = fallbackBasePrice;
                            const variantFinalPrice = calculateFinalPrice(variantBasePrice);
                            const combinationObj = { "اللون": color };
                            variantsData.push({
                                productId: newProduct.id,
                                combination: JSON.stringify(combinationObj),
                                price: variantFinalPrice,
                                basePriceIQD: variantBasePrice,
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
