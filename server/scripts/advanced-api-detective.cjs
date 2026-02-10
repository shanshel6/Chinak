const axios = require('axios');
const fs = require('fs');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getBrowserHeaders() {
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
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

async function analyze1688Page() {
  try {
    const url = 'https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597RpQZVA&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:127876677,401:8872005,401:33613523&beginPage=1';
    
    console.log('🔍 Analyzing 1688 page structure...');
    
    const response = await axios.get(url, {
      headers: getBrowserHeaders(),
      timeout: 15000
    });
    
    const html = response.data;
    fs.writeFileSync('1688-page-analysis.html', html);
    
    console.log('✅ Page fetched successfully!');
    
    // Look for JSON data in script tags
    const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    const scripts = [];
    
    while ((match = scriptPattern.exec(html)) !== null) {
      scripts.push(match[1]);
    }
    
    console.log('📊 Found', scripts.length, 'script tags');
    
    // Look for JSON data patterns
    const jsonPatterns = [
      /window\.\w+\s*=\s*({[\s\S]*?});?/g,
      /var\s+\w+\s*=\s*({[\s\S]*?});?/g,
      /data:\s*({[\s\S]*?}),/g,
      /offers?:\s*\[[\s\S]*?\]/g,
      /products?:\s*\[[\s\S]*?\]/g
    ];
    
    const foundData = [];
    
    scripts.forEach((script, index) => {
      jsonPatterns.forEach(pattern => {
        const matches = script.match(pattern);
        if (matches) {
          matches.forEach(match => {
            if (match.length > 50 && match.length < 5000) {
              foundData.push({
                script: index + 1,
                data: match.trim()
              });
            }
          });
        }
      });
    });
    
    console.log('\n🎯 Found potential JSON data:', foundData.length);
    
    if (foundData.length > 0) {
      foundData.slice(0, 5).forEach((item, i) => {
        console.log(`\n📦 Data ${i + 1} from script ${item.script}:`);
        console.log(item.data.substring(0, 200) + '...');
      });
      
      // Save the data for analysis
      fs.writeFileSync('1688-json-data.txt', foundData.map(item => 
        `Script ${item.script}:\n${item.data}\n${'='.repeat(50)}\n`
      ).join('\n'));
    }
    
    // Look for API endpoints
    const apiPatterns = [
      /https?:\/\/[^"'\s]*\.(json|jsonp)[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\/api\/[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\.1688\.com[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\.alicdn\.com[^"'\s]*/gi
    ];
    
    const apiUrls = new Set();
    
    scripts.forEach(script => {
      apiPatterns.forEach(pattern => {
        const matches = script.match(pattern) || [];
        matches.forEach(url => {
          if (url.includes('offer') || url.includes('product') || url.includes('search')) {
            apiUrls.add(url);
          }
        });
      });
    });
    
    console.log('\n🌐 Found API URLs:', apiUrls.size);
    Array.from(apiUrls).slice(0, 10).forEach(url => {
      console.log('  ', url);
    });
    
    // Test some common patterns
    console.log('\n🧪 Testing common API patterns...');
    
    const testEndpoints = [
      'https://s.1688.com/selloffer/rpc/offer_search_result.json',
      'https://s.1688.com/selloffer/search_offer_result.json',
      'https://data.1688.com/json/get_offer_list.json',
      'https://offer.1688.com/api/offer/search.json'
    ];
    
    for (const endpoint of testEndpoints) {
      try {
        await delay(1000);
        console.log('Testing:', endpoint);
        
        const testResponse = await axios.get(endpoint, {
          headers: getBrowserHeaders(),
          timeout: 8000,
          params: {
            keywords: '女装',
            beginPage: 1
          }
        });
        
        console.log('✅ Status:', testResponse.status);
        console.log('Content-Type:', testResponse.headers['content-type']);
        
        if (typeof testResponse.data === 'object') {
          console.log('Data keys:', Object.keys(testResponse.data));
        }
        
      } catch (error) {
        console.log('❌ Failed:', error.message);
      }
      console.log('---');
    }
    
    console.log('\n🎉 Analysis complete! Check files:');
    console.log('  - 1688-page-analysis.html (full page HTML)');
    console.log('  - 1688-json-data.txt (extracted JSON data)');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
  }
}

analyze1688Page();