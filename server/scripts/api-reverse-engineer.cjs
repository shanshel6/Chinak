const axios = require('axios');
const fs = require('fs');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
];

const referrers = [
  'https://www.1688.com/',
  'https://s.1688.com/',
  'https://search.1688.com/',
  'https://detail.1688.com/'
];

function getRandomHeaders() {
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  const randomReferrer = referrers[Math.floor(Math.random() * referrers.length)];
  
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
    'Sec-Fetch-User': '?1',
    'Referer': randomReferrer
  };
}

async function analyzeCategoryPage() {
  try {
    const categoryUrl = 'https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597RpQZVA&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:33613523,401:8872005&beginPage=1';
    
    console.log('🔍 Analyzing 1688 category page for API endpoints...');
    await delay(2000 + Math.random() * 3000);
    
    // Fetch the category page
    const response = await axios.get(categoryUrl, {
      headers: getRandomHeaders(),
      timeout: 15000
    });
    
    console.log('✅ Page fetched successfully!');
    
    const html = response.data;
    fs.writeFileSync('category-analysis.html', html);
    
    // Look for common API patterns in 1688
    const apiPatterns = [
      'h5api',
      'offerList',
      'productData',
      'window.data',
      'jsonp',
      'callback',
      'data.offers',
      'searchResult',
      'sm-offer'
    ];
    
    console.log('\n🔎 Searching for API patterns in the HTML:');
    
    const lines = html.split('\n');
    const apiCandidates = [];
    
    lines.forEach((line, index) => {
      apiPatterns.forEach(pattern => {
        if (line.includes(pattern)) {
          const cleanLine = line.trim().substring(0, 200);
          apiCandidates.push({
            line: index + 1,
            pattern: pattern,
            content: cleanLine
          });
        }
      });
    });
    
    // Display found patterns
    if (apiCandidates.length > 0) {
      console.log('\n📋 Found potential API patterns:');
      apiCandidates.slice(0, 10).forEach(candidate => {
        console.log(`Line ${candidate.line}: [${candidate.pattern}] ${candidate.content}`);
      });
    } else {
      console.log('❌ No obvious API patterns found in HTML');
    }
    
    // Look for script tags with data
    const scriptTags = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    const dataScripts = scriptTags.filter(script => 
      script.includes('data') || script.includes('offer') || script.includes('product')
    );
    
    console.log('\n📊 Found', dataScripts.length, 'script tags with potential data');
    
    // Extract URLs from script tags
    const urlPatterns = [
      /https?:\/\/[^"'\s]*\.(json|jsonp|js)[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\.(1688|alibaba)[^"'\s]*/gi,
      /https?:\/\/[^"'\s]*\/api\/[^"'\s]*/gi
    ];
    
    const foundUrls = new Set();
    
    dataScripts.forEach(script => {
      urlPatterns.forEach(pattern => {
        const matches = script.match(pattern) || [];
        matches.forEach(url => foundUrls.add(url));
      });
    });
    
    console.log('\n🌐 Found potential API URLs:');
    Array.from(foundUrls).slice(0, 5).forEach(url => {
      console.log('  ', url);
    });
    
    // Test common 1688 API endpoints
    const commonEndpoints = [
      'https://h5api.m.1688.com/h5/mtop.1688.search.suggest/1.0/',
      'https://h5api.m.1688.com/h5/mtop.1688.search.offerResult/1.0/',
      'https://s.1688.com/selloffer/search_offer_result.json'
    ];
    
    console.log('\n🧪 Testing common 1688 API endpoints...');
    
    for (const endpoint of commonEndpoints) {
      try {
        await delay(1000 + Math.random() * 2000);
        console.log('Testing:', endpoint);
        
        const apiResponse = await axios.get(endpoint, {
          headers: getRandomHeaders(),
          timeout: 8000,
          params: {
            keywords: '女装',
            beginPage: 1,
            spm: 'a260k.home2025.category.dL2.66333597RpQZVA'
          }
        });
        
        console.log('✅ Response status:', apiResponse.status);
        console.log('Content type:', apiResponse.headers['content-type']);
        console.log('Data length:', apiResponse.data?.length || 'No data');
        
        if (typeof apiResponse.data === 'object') {
          console.log('Data keys:', Object.keys(apiResponse.data));
        }
        
      } catch (error) {
        console.log('❌ Failed:', error.message);
      }
      console.log('---');
    }
    
    console.log('\n🎯 Analysis complete! Check category-analysis.html for detailed HTML');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
  }
}

analyzeCategoryPage();