
import vanillaPuppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const puppeteer = puppeteerExtra.addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

const targetUrl = 'https://detail.tmall.com/item.htm?id=863261778926'; // Using a known ID or the one from the user if valid. 
const TEST_URL = 'https://detail.tmall.com/item.htm?id=744573177673';

async function delay(ms) {
    console.log(`DEBUG: delaying for ${ms}ms`);
    await new Promise(resolve => setTimeout(resolve, ms));
    console.log(`DEBUG: delay finished`);
}

async function safeGoto(page, url, options = {}) {
    try {
        console.log(`DEBUG: page.goto ${url} start`);
        await page.goto(url, options);
        console.log(`DEBUG: page.goto ${url} end`);
    } catch (e) {
        console.log(`[Navigation] Error navigating to ${url}: ${e.message}`);
    }
}


async function run() {
    let browser;
    try {
        const executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"; // Adjust if needed
        if (!fs.existsSync(executablePath)) {
            console.error('Chrome not found at ' + executablePath);
            return;
        }

        browser = await puppeteer.launch({
            executablePath,
            headless: false,
            defaultViewport: null,
            userDataDir: 'chrome_data_taobao_persistent', // Use the same profile
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--lang=zh-CN,zh'
            ]
        });

        const page = await browser.newPage();
    
    // Stealth masking
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
            Promise.resolve({ state: 'denied' }) :
            originalQuery(parameters)
        );
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    // Navigate to search page to find a valid item
    const SEARCH_URL = 'https://s.taobao.com/search?q=shirt';
    console.log(`Navigating to search page: ${SEARCH_URL}`);
    console.log('TRACE: Calling safeGoto search');
    await safeGoto(page, SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('TRACE: safeGoto search returned');
    await delay(1000);
    console.log('TRACE: delay finished');

    // Get first item link
    const itemUrl = await page.evaluate(() => {
        const link = document.querySelector('a[href*="item.htm"]');
        return link ? link.href : null;
    });
    console.log('TRACE: itemUrl evaluated', itemUrl);

    if (!itemUrl) {
        console.error('No item link found on search page.');
        await page.screenshot({ path: 'debug_search_fail.png' });
        return;
    }

    console.log(`Found item URL: ${itemUrl}`);
    
    // Navigate to item
    console.log('TRACE: Calling safeGoto item');
    await safeGoto(page, itemUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('TRACE: safeGoto item returned');
    console.log('Page loaded (domcontentloaded). Waiting for stability...');
    await new Promise(r => setTimeout(r, 5000));

    // Check for login
    const title = await page.title();
        console.log('Page Title:', title);
        
        if (title.includes('login') || title.includes('登录')) {
            console.log('DETECTED LOGIN PAGE!');
        }

        // Check for __ICE_APP_CONTEXT__
        const iceContext = await page.evaluate(() => {
            try {
                return window.__ICE_APP_CONTEXT__ || null;
            } catch (e) { return e.message; }
        });

        console.log('__ICE_APP_CONTEXT__ found:', !!iceContext);
        if (iceContext) {
            console.log('Keys in ICE Context:', Object.keys(iceContext));
        }

        // Check for TShop
        const tshop = await page.evaluate(() => {
            try {
                return window.TShop || null;
            } catch (e) { return e.message; }
        });
        console.log('TShop found:', !!tshop);

        // Check for price elements in DOM
        const priceText = await page.evaluate(() => {
            const el = document.querySelector('.priceWrap--zpxd3_sO') || document.querySelector('.Price--priceText--2nLbVda');
            return el ? el.innerText : 'Not found';
        });
        console.log('DOM Price Text:', priceText);

        // Screenshot
        await page.screenshot({ path: 'debug_taobao.png' });
        console.log('Screenshot saved to debug_taobao.png');

        // Dump HTML
        const html = await page.content();
        fs.writeFileSync('debug_taobao.html', html);
        console.log('HTML saved to debug_taobao.html');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        if (browser) await browser.close();
    }
}

run().catch(console.error);
