import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function extractLameiImages() {
  console.log('=== 1688 辣妹T恤 Image Extractor ===');
  
  const productUrl = 'https://detail.1688.com/offer/951410798382.html?offerId=951410798382&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5869791617807&forcePC=1769593077326';
  
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
    console.log('🌐 Fetching 辣妹T恤 product page for images...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('✅ Page loaded successfully!\n');
    
    const $ = cheerio.load(response.data);
    
    // Extract all images
    const productImages = [];
    
    // Look for main product images
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      const dataSrc = $(elem).attr('data-src');
      const dataImage = $(elem).attr('data-image');
      
      if (src && (src.includes('alicdn') || src.includes('1688'))) {
        productImages.push(src);
      }
      if (dataSrc && (dataSrc.includes('alicdn') || dataSrc.includes('1688'))) {
        productImages.push(dataSrc);
      }
      if (dataImage && (dataImage.includes('alicdn') || dataImage.includes('1688'))) {
        productImages.push(dataImage);
      }
    });

    // Remove duplicates
    const uniqueImages = [...new Set(productImages)];
    
    console.log(`📸 Found ${uniqueImages.length} product images:`);
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img}`);
    });
    
    // Write to file
    const output = [
      '=== 1688 辣妹T恤 Product Images ===',
      `Extracted from: ${productUrl}`,
      `Total images found: ${uniqueImages.length}`,
      '',
      ...uniqueImages.map((img, index) => `${index + 1}. ${img}`),
      '',
      '=== HTML Content Analysis ===',
      response.data.substring(0, 2000) // First 2000 chars for analysis
    ];
    
    fs.writeFileSync('lamei-product-images.txt', output.join('\n'));
    console.log('\n💾 Images saved to lamei-product-images.txt');
    
  } catch (error) {
    console.error('❌ Error extracting images:', error.message);
  }
}

// Run the extraction
extractLameiImages();