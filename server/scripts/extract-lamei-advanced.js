import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function extractLameiAdvanced() {
  console.log('=== 1688 辣妹T恤 Advanced Image Extractor ===');
  
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
    console.log('🌐 Fetching 辣妹T恤 product page for advanced analysis...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('✅ Page loaded successfully!\n');
    
    const $ = cheerio.load(response.data);
    
    // Save the full HTML for analysis
    fs.writeFileSync('lamei-full-html.txt', response.data);
    console.log('💾 Full HTML saved to lamei-full-html.txt');
    
    // Search for image patterns in the HTML
    const imagePatterns = [
      /https:\/\/[^\s"]*\.(jpg|jpeg|png|webp|gif)/gi,
      /data-src="([^"]*\.(jpg|jpeg|png|webp|gif)[^"]*)"/gi,
      /data-image="([^"]*\.(jpg|jpeg|png|webp|gif)[^"]*)"/gi,
      /src="([^"]*\.(jpg|jpeg|png|webp|gif)[^"]*)"/gi
    ];
    
    const allImages = [];
    
    // Search through HTML content
    imagePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(response.data)) !== null) {
        if (match[1]) {
          allImages.push(match[1]);
        } else if (match[0]) {
          allImages.push(match[0]);
        }
      }
    });
    
    // Filter for product images (remove icons, logos, etc.)
    const productImages = allImages.filter(img => 
      img.includes('alicdn') && 
      !img.includes('icon') && 
      !img.includes('logo') && 
      !img.includes('sprites') &&
      img.length > 30
    );
    
    // Remove duplicates
    const uniqueImages = [...new Set(productImages)];
    
    console.log(`📸 Found ${uniqueImages.length} potential product images:`);
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img}`);
    });
    
    // Search for JSON data that might contain images
    const jsonPatterns = [
      /offerImgList\s*[:=]\s*(\[[^\]]+\])/gi,
      /imageList\s*[:=]\s*(\[[^\]]+\])/gi,
      /gallery\s*[:=]\s*(\[[^\]]+\])/gi,
      /"images"\s*[:]\s*(\[[^\]]+\])/gi
    ];
    
    let jsonImages = [];
    jsonPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(response.data)) !== null) {
        if (match[1]) {
          try {
            const images = JSON.parse(match[1]);
            if (Array.isArray(images)) {
              jsonImages = jsonImages.concat(images);
            }
          } catch (e) {
            // Not valid JSON, continue
          }
        }
      }
    });
    
    if (jsonImages.length > 0) {
      console.log(`\n🎯 Found ${jsonImages.length} images in JSON data:`);
      jsonImages.forEach((img, index) => {
        console.log(`${index + 1}. ${img}`);
      });
    }
    
    // Combine all images
    const allFoundImages = [...uniqueImages, ...jsonImages];
    const finalImages = [...new Set(allFoundImages)];
    
    console.log(`\n📊 Total unique images found: ${finalImages.length}`);
    
    // Save results
    const output = [
      '=== 1688 辣妹T恤 Advanced Image Extraction ===',
      `Extracted from: ${productUrl}`,
      `Total unique images: ${finalImages.length}`,
      '',
      'IMAGES:',
      ...finalImages.map((img, index) => `${index + 1}. ${img}`),
      '',
      '=== HTML ANALYSIS ===',
      'First 2000 characters:',
      response.data.substring(0, 2000)
    ];
    
    fs.writeFileSync('lamei-advanced-results.txt', output.join('\n'));
    console.log('💾 Advanced results saved to lamei-advanced-results.txt');
    
  } catch (error) {
    console.error('❌ Error in advanced extraction:', error.message);
  }
}

// Run the extraction
extractLameiAdvanced();