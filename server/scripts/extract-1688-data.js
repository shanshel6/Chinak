import axios from 'axios';
import * as fs from 'fs';

async function extract1688Data() {
  console.log('=== 1688 Data Extractor ===');
  
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
    
    // Save the full HTML for reference
    fs.writeFileSync('1688-full-page.html', html);
    console.log('📁 Full HTML saved to: 1688-full-page.html');
    
    // Look for specific data patterns in the HTML
    const patterns = {
      title: /<title>([^<]+)<\/title>/, 
      price: /(?:¥|RMB|价格)[^\d]*([\d.,]+)/,
      offerId: /offerId[^\d]*(\d+)/,
      seller: /offerLoginId[^:]*:[^"']*["']([^"']+)["']/,
      images: /(https:[^"']*\.(?:jpg|png|jpeg|webp)[^"']*)/gi
    };
    
    console.log('\n🔍 Extracted Data:');
    
    // Extract title
    const titleMatch = html.match(patterns.title);
    if (titleMatch) {
      console.log('📝 Title:', titleMatch[1]);
    }
    
    // Extract offer ID
    const offerIdMatch = html.match(patterns.offerId);
    if (offerIdMatch) {
      console.log('🆔 Offer ID:', offerIdMatch[1]);
    }
    
    // Extract seller
    const sellerMatch = html.match(patterns.seller);
    if (sellerMatch) {
      console.log('🏪 Seller:', sellerMatch[1]);
    }
    
    // Extract prices
    const priceMatches = [];
    let priceMatch;
    while ((priceMatch = patterns.price.exec(html)) !== null) {
      priceMatches.push(priceMatch[1]);
    }
    if (priceMatches.length > 0) {
      console.log('💰 Prices found:', [...new Set(priceMatches)].join(', '));
    }
    
    // Extract images
    const imageMatches = [];
    let imageMatch;
    while ((imageMatch = patterns.images.exec(html)) !== null) {
      if (imageMatch[1].includes('1688') || imageMatch[1].includes('alicdn')) {
        imageMatches.push(imageMatch[1]);
      }
    }
    if (imageMatches.length > 0) {
      console.log('🖼️ Images found:', imageMatches.length);
      console.log('   First image:', imageMatches[0]);
    }
    
    // Look for JavaScript data objects
    const jsDataPatterns = [
      /window\.FE_GLOBALS\s*=\s*({[^}]+})/,
      /window\.context\s*=\s*([^;]+);/,
      /"product"[^:]*:[^{]*({[^}]+})/
    ];
    
    for (const pattern of jsDataPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        fs.writeFileSync('1688-js-data.txt', match[1]);
        console.log('📁 JavaScript data saved to: 1688-js-data.txt');
        break;
      }
    }
    
    // Special: Look for the specific data you mentioned
    const specificDataPattern = /window\.context\s*=\s*\(function\([^)]*\)\{([\s\S]*?)\}\)\([^)]*\)/;
    const specificMatch = html.match(specificDataPattern);
    
    if (specificMatch) {
      fs.writeFileSync('1688-specific-data.js', specificMatch[0]);
      console.log('📁 Specific window.context data saved to: 1688-specific-data.js');
      
      // Try to extract just the JSON part
      const jsonPart = specificMatch[0].match(/"result":\s*({[\s\S]*?})(?:\s*[);]|\s*$)/);
      if (jsonPart && jsonPart[1]) {
        fs.writeFileSync('1688-result-data.txt', jsonPart[1]);
        console.log('📁 Result data saved to: 1688-result-data.txt');
      }
    }
    
    console.log('\n✅ All data extracted successfully!');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

extract1688Data().catch(console.error);