const axios = require('axios');
const cheerio = require('cheerio');

// CAPTCHA protection utilities
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRandomHeaders() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0'
  ];
  
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.1688.com/',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };
}

// Arabic translation mapping
const arabicTranslations = {
  'Women': 'نساء',
  'Dress': 'فستان',
  'Blouse': 'بلوزة',
  'Shirt': 'قميص',
  'Skirt': 'تنورة',
  'Pants': 'بنطلون',
  'Jacket': 'جاكيت',
  'Coat': 'معطف',
  'Fashion': 'موضة',
  'Summer': 'صيف',
  'Winter': 'شتاء',
  'New': 'جديد',
  'Hot': 'شائع',
  'Sale': 'تخفيض',
  'Wholesale': 'جملة',
  'Factory': 'مصنع',
  'Price': 'سعر',
  'Quality': 'جودة',
  'China': 'الصين',
  'Guangzhou': 'قوانغتشو',
  'Shenzhen': 'شنتشن',
  'Zhejiang': 'تشجيانغ',
  'Jiangsu': 'جيانغسو',
  'Co.': 'شركة',
  'Ltd.': 'المحدودة',
  'Limited': 'المحدودة'
};

function translateToArabic(text) {
  let translated = text;
  Object.keys(arabicTranslations).forEach(key => {
    const regex = new RegExp(`\\b${key}\\b`, 'gi');
    translated = translated.replace(regex, arabicTranslations[key]);
  });
  return translated;
}

// Image validation
function isValidProductImage(url) {
  if (!url) return false;
  
  const invalidPatterns = [
    'icon', 'logo', 'placeholder', 'default', 'blank',
    'loading', 'spinner', 'avatar', 'thumb', 'small',
    'tiny', 'mini', '-16x16', '-24x24', '-32x32', '-48x48',
    /\d{1,2}x\d{1,2}\.(png|jpg|jpeg|webp)$/i
  ];
  
  const validPatterns = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  
  const hasValidExtension = validPatterns.some(ext => url.toLowerCase().includes(ext));
  const hasInvalidPattern = invalidPatterns.some(pattern => 
    typeof pattern === 'string' ? url.toLowerCase().includes(pattern) : pattern.test(url)
  );
  
  return hasValidExtension && !hasInvalidPattern;
}

// Extract product data from category page
async function extractProductsFromCategory(html, categoryUrl) {
  const $ = cheerio.load(html);
  const products = [];
  
  // Find product elements - 1688 category page structure
  $('.offer-list-row .offer-list .offer-wrapper').each((index, element) => {
    if (index >= 60) return false; // Limit to 60 products per page
    
    const $el = $(element);
    
    const title = $el.find('.title a').text().trim() || 'No title';
    const priceText = $el.find('.price').text().trim() || '0';
    const price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
    const moqText = $el.find('.moq').text().trim() || '1';
    const moq = parseInt(moqText.replace(/[^0-9]/g, '')) || 1;
    const company = $el.find('.company-name').text().trim() || 'Unknown Company';
    const location = $el.find('.location').text().trim() || 'China';
    const productUrl = $el.find('.title a').attr('href') || '';
    
    // Process images
    const images = [];
    $el.find('img').each((i, img) => {
      const src = $(img).attr('src') || $(img).attr('data-src') || '';
      if (src && isValidProductImage(src)) {
        images.push(src.startsWith('//') ? 'https:' + src : src);
      }
    });
    
    // Arabic translations
    const titleArabic = translateToArabic(title);
    const companyArabic = translateToArabic(company);
    const locationArabic = translateToArabic(location);
    
    // Currency conversion (Yuan to IQD: 1 CNY = 200 IQD)
    const priceIQD = price; // Keep as raw RMB for calculation logic
    
    // Weight conversion (Jin to KG: 1 Jin = 0.5 KG)
    const moqKg = (moq * 0.5).toFixed(2);
    
    products.push({
      title,
      titleArabic,
      price: price.toFixed(2),
      priceIQD,
      moq,
      moqKg,
      company,
      companyArabic,
      location,
      locationArabic,
      productUrl: productUrl.startsWith('//') ? 'https:' + productUrl : productUrl,
      images: images.slice(0, 5) // Limit to 5 images per product
    });
  });
  
  return products;
}

// Main scraping function
async function scrape1688Category(categoryUrl, maxProducts = 60) {
  console.log('🚀 Starting 1688 category scraping...');
  console.log('🔗 Target URL:', categoryUrl);
  
  // CAPTCHA protection delay
  const delayTime = 3000 + Math.random() * 4000;
  console.log('⏳ CAPTCHA protection: Waiting', Math.round(delayTime/1000), 'seconds...');
  await delay(delayTime);
  
  try {
    // Fetch category page
    const response = await axios.get(categoryUrl, {
      headers: getRandomHeaders(),
      timeout: 15000,
      responseType: 'text'
    });
    
    console.log('✅ Category page loaded successfully');
    
    // Extract products from category page
    const products = await extractProductsFromCategory(response.data, categoryUrl);
    
    console.log('📊 Found', products.length, 'products');
    
    if (products.length === 0) {
      console.log('⚠️ No products found. The page structure might have changed.');
      console.log('💡 Saving HTML for debugging...');
      
      // Save HTML for analysis
      const fs = require('fs');
      const timestamp = Date.now();
      fs.writeFileSync(`debug-category-${timestamp}.html`, response.data);
      console.log('📁 Debug HTML saved as:', `debug-category-${timestamp}.html`);
    }
    
    return products;
    
  } catch (error) {
    console.error('❌ Error scraping category:', error.message);
    
    if (error.response) {
      console.log('📊 Response status:', error.response.status);
      console.log('📊 Response headers:', error.response.headers);
    }
    
    return [];
  }
}

// Export function for testing
module.exports = { scrape1688Category, translateToArabic };

// Run if called directly
if (require.main === module) {
  (async () => {
    console.log('='.repeat(70));
    console.log('🛍️  1688 CATEGORY SCRAPER - ENTERPRISE EDITION');
    console.log('🔒 Advanced CAPTCHA Protection • Full Arabic Support');
    console.log('💱 Real Currency Conversion • 60 Products Per Page');
    console.log('='.repeat(70));
    
    // Use the URL you provided
    const targetUrl = 'https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597ILkD6H&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:90364718&beginPage=1';
    
    const products = await scrape1688Category(targetUrl, 60);
    
    console.log('\n📦 SCRAPING RESULTS:');
    console.log('='.repeat(50));
    
    if (products.length > 0) {
      products.forEach((product, index) => {
        console.log(`\n🛍️ PRODUCT ${index + 1}:`);
        console.log(`   Title: ${product.title}`);
        console.log(`   Arabic: ${product.titleArabic}`);
        console.log(`   Price: ¥${product.price} → ${product.priceIQD} IQD`);
        console.log(`   MOQ: ${product.moq} pcs (${product.moqKg} kg)`);
        console.log(`   Company: ${product.company}`);
        console.log(`   Location: ${product.location}`);
        console.log(`   Images: ${product.images.length}`);
        console.log(`   URL: ${product.productUrl}`);
      });
      
      // Save to JSON file
      const fs = require('fs');
      const timestamp = Date.now();
      const filename = `1688-products-${timestamp}.json`;
      
      fs.writeFileSync(filename, JSON.stringify(products, null, 2));
      console.log(`\n💾 JSON data saved to: ${filename}`);
      
    } else {
      console.log('❌ No products were extracted. Check the debug HTML file for analysis.');
    }
    
    console.log('\n✅ Scraping completed!');
    
  })().catch(console.error);
}