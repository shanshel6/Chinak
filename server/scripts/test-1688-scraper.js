import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Test 1688 Scraper - Safe isolated testing
 * This is completely separate from your main app
 */

async function test1688Scraper() {
  console.log('=== 1688 Scraper Test ===');
  
  // Your actual 1688 product URL
  const testUrl = 'https://detail.1688.com/offer/991775818085.html?offerId=991775818085&forcePC=1769586521761';
  
  // Your actual 1688 cookies (from Chrome DevTools)
  const exampleCookies = [
    'mtop_partitioned_detect=1',
    't=d045a542d9d514096e017a885f5dcb91',
    'sgcookie=E100lGD4JADOn7x3xLZ32JvX6bpd7zVZDZ5fWuweG9PMhr69fLkBddgOG6O4ct%2FVCBIDpovMys1Wqk1ypG0IqdjzlZjaLsO3oL2M60yXaunPuxk%3D',
    'unb=2220268184498',
    'uc4=id4=0%40U2gp9rIfvxVio8oSMhjuUS5SYrkxjn6R&nk4=0%40FY4NAA%2BTw091FWXGdnFtuFNaCzFTX%2BhGtw%3D%3D',
    'sg=081',
    'xlly_s=1'
  ].join('; ');
  
  console.log('Testing URL:', testUrl);
  console.log('Using example cookies format (replace with your actual cookies)');
  
  try {
    // Test the request
    const response = await axios.get(testUrl, {
      headers: {
        'Cookie': exampleCookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000,
      maxRedirects: 5
    });
    
    console.log('✅ Successfully fetched page');
    console.log('Status:', response.status);
    console.log('Content length:', response.data.length, 'characters');
    
    // Try to parse the HTML
    const $ = cheerio.load(response.data);
    
    // 1688-specific selectors
    const productData = {
      title: $('.product-title').text().trim() || 
             $('h1.d-title').text().trim() ||
             $('[data-spm="dtitle"]').text().trim(),
      
      price: $('.price-value').text().trim() || 
            $('.sku-price').text().trim() ||
            $('[data-spm="dprice"]').text().trim() ||
            $('.price').text().trim(),
      
      mainImage: $('.main-img').attr('src') || 
                $('.image-view img').attr('src') ||
                $('.detail-desc-decorate-roots img').first().attr('src'),
      
      // Try to find shipping/delivery info
      shipping: $('.delivery-price').text().trim() ||
               $('.freight-price').text().trim() ||
               $('[data-spm="dfreight"]').text().trim(),
      
      // Try to find all images
      allImages: []
    };
    
    // Find all product images
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && src.includes('1688') && (src.includes('.jpg') || src.includes('.png'))) {
        productData.allImages.push(src);
      }
    });
    
    console.log('\n📦 Extracted product data:');
    console.log('Title:', productData.title || 'Not found');
    console.log('Price:', productData.price || 'Not found');
    console.log('Shipping/Delivery:', productData.shipping || 'Not found');
    console.log('Main Image:', productData.mainImage ? 'Found' : 'Not found');
    
    // Show first few images if found
    if (productData.allImages.length > 0) {
      console.log('Total Images Found:', productData.allImages.length);
      console.log('First 3 Images:');
      productData.allImages.slice(0, 3).forEach((img, i) => {
        console.log(`  ${i + 1}. ${img}`);
      });
    }
    
    // Check if we got redirected to login page
    if (response.data.includes('login.1688.com') || 
        response.data.includes('安全验证') || 
        response.data.includes('请登录')) {
      console.log('\n❌ Redirected to login page - cookies may be invalid/expired');
      console.log('Tip: Check your cookies in browser dev tools');
    } else {
      console.log('\n✅ Page appears to be product page (not login)');
    }
    
  } catch (error) {
    console.error('\n❌ Error during scraping:');
    
    if (error.response) {
      console.log('HTTP Status:', error.response.status);
      console.log('HTTP Headers:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.log('No response received - network error or timeout');
    } else {
      console.log('Error message:', error.message);
    }
  }
  
  console.log('\n=== Test Complete ===');
  console.log('Next steps:');
  console.log('1. Replace testUrl with your actual 1688 product link');
  console.log('2. Replace exampleCookies with your actual browser cookies');
  console.log('3. Run: node server/scripts/test-1688-scraper.js');
}

// Run the test
test1688Scraper().catch(console.error);