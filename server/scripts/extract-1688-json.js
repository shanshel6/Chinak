import axios from 'axios';
import * as fs from 'fs';

async function extract1688JSON() {
  console.log('=== 1688 JSON Data Extractor ===');
  
  const testUrl = 'https://detail.1688.com/offer/991775818085.html?offerId=991775818085&forcePC=1769586521761';
  
  // Your actual 1688 cookies
  const exampleCookies = [
    'mtop_partitioned_detect=1',
    't=d045a542d9d514096e017a885f5dcb91',
    'sgcookie=E100lGD4JADOn7x3xLZ32JvX6bpd7zVZDZ5fWuweG9PMhr69fLkBddgOG6O4ct%2FVCBIDpovMys1Wqk1ypG0IqdjzlZjaLsO3oL2M60yXaunPuxk%3D',
    'unb=2220268184498',
    'uc4=id4=0%40U2gp9rIfvxVio8oSMhjuUS5SYrkxjn6R&nk4=0%40FY4NAA%2BTw091FWXGdnFtuFNaCzFTX%2BhGtw%3D%3D',
    'sg=081',
    'xlly_s=1'
  ].join('; ');
  
  try {
    const response = await axios.get(testUrl, {
      headers: {
        'Cookie': exampleCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 15000,
    });
    
    const html = response.data;
    
    // Look for the window.context JSON data
    const jsonMatch = html.match(/window\.context\s*=\s*(\(function\([\s\S]*?\)\)\([^)]*\))/);
    
    if (jsonMatch && jsonMatch[1]) {
      console.log('✅ Found window.context data');
      
      // Try to extract the JSON part more precisely
      const jsonPattern = /window\.context\s*=\s*\(function\([^)]*\)\{([\s\S]*?)\}\)\([^)]*\)/;
      const preciseMatch = html.match(jsonPattern);
      
      if (preciseMatch && preciseMatch[0]) {
        // Save the raw JavaScript to file
        fs.writeFileSync('window-context-raw.js', preciseMatch[0]);
        console.log('📁 Raw JavaScript saved to: window-context-raw.js');
      }
      
      // Try to find the actual JSON data within the function
      const jsonDataPattern = /"result":\s*({[\s\S]*?})(?:\s*[);]|\s*$)/;
      const jsonDataMatch = html.match(jsonDataPattern);
      
      if (jsonDataMatch && jsonDataMatch[1]) {
        try {
          const jsonData = JSON.parse(jsonDataMatch[1]);
          fs.writeFileSync('1688-product-data.json', JSON.stringify(jsonData, null, 2));
          console.log('✅ JSON data extracted and saved to: 1688-product-data.json');
          
          // Extract key product information
          if (jsonData.data && jsonData.data.product) {
            const product = jsonData.data.product;
            console.log('\n📦 Product Information:');
            console.log('Name:', product.subject || product.title || 'Not found');
            console.log('Price:', product.price || product.priceRange || 'Not found');
            console.log('SKUs:', product.skuList ? product.skuList.length : 0, 'variants');
            
            if (product.skuList && product.skuList.length > 0) {
              console.log('First SKU price:', product.skuList[0].price);
            }
          }
          
        } catch (parseError) {
          console.log('Could not parse as JSON, saving as text');
          fs.writeFileSync('1688-data-text.txt', jsonDataMatch[1]);
        }
      }
      
    } else {
      console.log('❌ Could not find window.context data');
      
      // Alternative approach: look for any JSON-like data
      const jsonLikePattern = /({[\s\S]*?"product"[\s\S]*?})/;
      const jsonLikeMatch = html.match(jsonLikePattern);
      
      if (jsonLikeMatch && jsonLikeMatch[1]) {
        fs.writeFileSync('1688-json-like-data.txt', jsonLikeMatch[1]);
        console.log('📁 Found JSON-like data, saved to: 1688-json-like-data.txt');
      }
    }
    
    // Also look for simple patterns
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      console.log('📝 Page Title:', titleMatch[1]);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

extract1688JSON().catch(console.error);