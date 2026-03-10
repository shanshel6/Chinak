import vanillaPuppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const puppeteer = puppeteerExtra.addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import readline from 'readline';
import { fileURLToPath } from 'url';

// Load .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const COOKIES_DIR = path.join(__dirname, '..', 'cookies');

// Ensure cookies directory exists
if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

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

function getExecutablePath() {
    if (process.env.PDD_CHROME_PATH && fs.existsSync(process.env.PDD_CHROME_PATH)) {
        return process.env.PDD_CHROME_PATH;
    }
    const paths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe"
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    console.error("Chrome executable not found. Please install Chrome.");
    process.exit(1);
}

(async () => {
    console.log('================================================');
    console.log('      Pinduoduo Login Assistant (Proxy Enabled)   ');
    console.log('================================================');

    // Proxy Config
    const proxyProtocol = process.env.PDD_PROXY_PROTOCOL || 'http';
    const proxyHost = process.env.PDD_PROXY_HOST || '192.168.2.150';
    const proxyPort = process.env.PDD_PROXY_PORT || '7890';
    const proxyUrl = `${proxyProtocol}://${proxyHost}:${proxyPort}`;

    console.log(`Using Proxy: ${proxyUrl}`);

    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list', // Also ignore SPKI errors
        '--disable-blink-features=AutomationControlled',
        `--proxy-server=${proxyUrl}`,
        '--start-maximized',
        // Disable QUIC and other protocols that might conflict with proxy
        '--disable-quic',
        '--disable-http2'
    ];

    console.log('Launching Browser...');
    const browser = await puppeteer.launch({
        executablePath: getExecutablePath(),
        headless: false,
        defaultViewport: null,
        args: args,
        ignoreHTTPSErrors: true, // Explicitly ignore HTTPS errors at launch config
        userDataDir: path.join(os.tmpdir(), 'pdd_login_session') 
    });

    const page = await browser.newPage();

    // Authenticate Proxy
    if (process.env.PDD_PROXY_USER && process.env.PDD_PROXY_PASS) {
        console.log('Authenticating with Proxy...');
        await page.authenticate({
            username: process.env.PDD_PROXY_USER,
            password: process.env.PDD_PROXY_PASS
        });
    }

    console.log('Navigating to Pinduoduo Login Page...');
    
    // Set a very long default timeout
    page.setDefaultNavigationTimeout(180000); // 3 minutes
    
    // Go to personal center which usually forces login
    try {
        console.log('Loading page... (This may take 1-2 minutes on first load)');
        await page.goto('https://mobile.pinduoduo.com/personal.html', { waitUntil: 'domcontentloaded', timeout: 180000 });
    } catch (e) {
        console.warn('⚠️ Navigation Timeout/Error:', e.message);
        console.log('The page might have loaded partially or the proxy is slow.');
        console.log('Please check the browser window manually. If it is blank, try refreshing it.');
    }

    console.log('\n--- ACTION REQUIRED ---');
    console.log('Please interact with the browser window to Log In.');
    console.log('1. Use Phone Number or WeChat login if available.');
    console.log('2. Verify you are fully logged in (you can see your profile).');
    console.log('3. Come back here and press ENTER to save cookies.');
    
    await askQuestion('\nPress ENTER after you have successfully logged in...');

    console.log('Saving cookies...');
    const cookies = await page.cookies();
    
    // Save to a prioritized file
    const cookiePath = path.join(COOKIES_DIR, 'latest_session.json');
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    
    console.log(`✅ Cookies saved to: ${cookiePath}`);
    console.log('You can now close this window and run the scraper.');
    console.log('The scraper will automatically use "latest_session.json".');

    await browser.close();
    process.exit(0);
})();
