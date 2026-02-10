import axios from 'axios';
import * as cheerio from 'cheerio';

async function extractY2KImages() {
  console.log('=== 1688 Y2K Product Image Extractor ===');
  
  const productUrl = 'https://detail.1688.com/offer/929430957207.html?offerId=929430957207&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5979042322969&forcePC=1769591684134';
  
  // Your actual 1688 cookies
  const cookies = [
    'mtop_partitioned_detect=1',
    't=d045a542d9d514096e017a885f5dcb91',
    'sgcookie=E100lGD4JADOn7x3xLZ32JvX6bpd7zVZDZ5fWuweG9PMhr69fLkBddgOG6O4ct%2FVCBIDpovMys1Wqk1ypG0IqdjzlZjaLsO3oL2M60yXaunPuxk%3D',
    'unb=2220268184498',
    'uc4=id4=0%40U2gp9rIfvxVio8oSMhjuUS5SYrkxjn6R&nk4=0%40FY4NAA%2BTw091FWXGdnFtuFNaCzFTX%2BhGtw%3D%3D',
    'sg=081',
    'xlly_s=1'
  ].join('; ');

  try {
    console.log('🌐 Fetching Y2K product page...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('✅ Page loaded! Extracting images...\n');
    
    const $ = cheerio.load(response.data);
    
    // Extract all product images
    const productImages = [];
    
    // Look for product images in various selectors
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      const dataSrc = $(elem).attr('data-src');
      
      // Check for product images (typically from alicdn)
      if (src && src.includes('alicdn') && !productImages.includes(src)) {
        productImages.push(src);
      }
      
      if (dataSrc && dataSrc.includes('alicdn') && !productImages.includes(dataSrc)) {
        productImages.push(dataSrc);
      }
    });
    
    // Also check for images in JavaScript data
    const htmlContent = response.data;
    
    // Look for image URLs in the HTML content
    const imageRegex = /https:\/\/[^\s]*\.(jpg|jpeg|png|webp)[^\s]*/gi;
    const foundImages = htmlContent.match(imageRegex) || [];
    
    foundImages.forEach(img => {
      if (img.includes('alicdn') && !productImages.includes(img)) {
        productImages.push(img);
      }
    });
    
    console.log('🖼️ REAL PRODUCT IMAGES FOUND:');
    console.log('==============================');
    
    if (productImages.length > 0) {
      // Show only first 10 images
      const displayImages = productImages.slice(0, 10);
      displayImages.forEach((img, index) => {
        console.log(`${index + 1}. ${img}`);
      });
      
      console.log(`\n✅ Total found: ${productImages.length} images`);
      
      // Main images for extractor (first 5)
      const mainImages = productImages.slice(0, 5);
      
      console.log('\n📋 MAIN IMAGES FOR Y2K EXTRACTOR:');
      console.log(JSON.stringify(mainImages, null, 2));
      
    } else {
      console.log('❌ No product images found in page');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the extractor
extractY2KImages();