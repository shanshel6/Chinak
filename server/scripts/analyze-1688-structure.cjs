const axios = require('axios');
const cheerio = require('cheerio');

async function analyze1688Structure() {
  try {
    const url = "https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597ILkD6H&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:90364718&beginPage=1";
    
    console.log("🔍 Analyzing 1688 category page structure...");
    console.log("📄 URL:", url);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    
    console.log("\n📊 PAGE ANALYSIS:");
    console.log("Title:", $('title').text().trim());
    
    // Look for common product container patterns
    const commonSelectors = [
      '.offer-list',
      '.product-list',
      '.item',
      '.offer-item',
      '.sm-offer',
      '[data-component*="offer"]',
      '[class*="offer"]',
      '[class*="product"]',
      '[class*="item"]'
    ];
    
    console.log("\n🔍 CHECKING COMMON SELECTORS:");
    commonSelectors.forEach(selector => {
      const elements = $(selector);
      if (elements.length > 0) {
        console.log(`✅ ${selector}: ${elements.length} elements found`);
        if (elements.length <= 5) {
          elements.each((i, el) => {
            console.log(`   ${i + 1}.`, $(el).attr('class') || $(el).attr('id') || 'No class/id');
          });
        }
      }
    });
    
    // Look for links that might be product links
    console.log("\n🔗 CHECKING POTENTIAL PRODUCT LINKS:");
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      const className = $(el).attr('class') || '';
      
      if (href && href.includes('offer') && href.includes('1688.com') && i < 20) {
        console.log(`🔗 Link ${i + 1}:`);
        console.log(`   URL: ${href}`);
        console.log(`   Text: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
        console.log(`   Class: ${className}`);
        console.log(`   ---`);
      }
    });
    
    // Look for images
    console.log("\n🖼️ CHECKING IMAGES:");
    $('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.includes('offer') && i < 10) {
        console.log(`🖼️ Image ${i + 1}: ${src}`);
      }
    });
    
    console.log("\n🎯 RECOMMENDED SELECTORS:");
    console.log("Based on analysis, try these selectors:");
    console.log("- Look for elements with 'offer' in class name");
    console.log("- Check links containing 'detail.1688.com' or 'offerid'");
    
  } catch (error) {
    console.error("❌ Error analyzing page:", error.message);
    if (error.response) {
      console.log("Status:", error.response.status);
      console.log("Headers:", error.response.headers);
    }
  }
}

analyze1688Structure();