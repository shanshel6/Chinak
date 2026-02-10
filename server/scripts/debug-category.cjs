const axios = require('axios');
const fs = require('fs');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getRandomHeaders() {
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  return {
    'User-Agent': randomUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };
}

async function fetchCategoryPage() {
  try {
    const url = 'https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597RpQZVA&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:33613523,401:8872005&beginPage=1';
    
    console.log('Fetching category page with CAPTCHA protection...');
    await delay(2000 + Math.random() * 3000);
    
    const response = await axios.get(url, {
      headers: getRandomHeaders(),
      timeout: 10000
    });
    
    console.log('Page fetched successfully!');
    console.log('Content length:', response.data.length);
    
    // Save the HTML for analysis
    fs.writeFileSync('debug-category.html', response.data);
    console.log('HTML saved to debug-category.html');
    
    // Look for product-related content
    const html = response.data;
    
    // Check for common patterns
    const hasScriptData = html.includes('window.data') || html.includes('offerList') || html.includes('productData');
    const hasProductElements = html.includes('offer-wrapper') || html.includes('product-item') || html.includes('sm-offer');
    
    console.log('Has script data:', hasScriptData);
    console.log('Has product elements:', hasProductElements);
    
    // Extract some sample content
    const lines = html.split('\n');
    const sampleLines = lines.filter(line => 
      line.includes('offer') || line.includes('product') || line.includes('data') || line.includes('window')
    ).slice(0, 10);
    
    console.log('\nSample relevant lines:');
    sampleLines.forEach((line, index) => {
      console.log(`${index + 1}: ${line.trim().substring(0, 100)}...`);
    });
    
  } catch (error) {
    console.error('Error fetching category page:', error.message);
  }
}

fetchCategoryPage();