import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function extractLameiRealImages() {
  console.log('=== 1688 辣妹T恤 Real Image Extractor ===');
  
  // Try both desktop and mobile versions
  const urls = [
    'https://detail.1688.com/offer/951410798382.html?offerId=951410798382&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5869791617807&forcePC=1769593077326',
    'https://m.1688.com/offer/951410798382.html'
  ];
  
  const cookies = [
    'mtop_partitioned_detect=1',
    't=d045a542d9d514096e017a885f5dcb91',
    'sgcookie=E100lGD4JADOn7x3xLZ32JvX6bpd7zVZDZ5fWuweG9PMhr69fLkBddgOG6O4ct%2FVCBIDpovMys1Wqk1ypG0IqdjzlZjaLsO3oL2M60yXaunPuxk%3D',
    'unb=2220268184498',
    'uc4=id4=0%40U2gp9rIfvxVio8oSMhjuUS5SYrkxjn6R&nk4=0%40FY4NAA%2BTw091FWXGdnFtuFNaCzFTX%2BhGtw%3D%3D',
    'sg=081',
    'xlly_s=1'
  ].join('; ');

  const allImages = [];

  try {
    for (const url of urls) {
      console.log(`🌐 Fetching: ${url}`);
      
      const userAgent = url.includes('m.1688.com') 
        ? 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      const response = await axios.get(url, {
        headers: {
          'Cookie': cookies,
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': 'https://www.1688.com/',
          'Connection': 'keep-alive'
        },
        timeout: 10000
      });

      console.log(`✅ Loaded: ${url}`);
      
      const $ = cheerio.load(response.data);
      
      // Save HTML for analysis
      const filename = url.includes('m.1688.com') ? 'lamei-mobile-full.html' : 'lamei-desktop-full.html';
      fs.writeFileSync(filename, response.data);
      console.log(`💾 Saved: ${filename}`);

      // Extract all possible image sources
      const imageSelectors = [
        'img[src*="alicdn"]',
        'img[data-src*="alicdn"]', 
        'img[data-image*="alicdn"]',
        'img[src*="1688"]',
        'img[data-src*="1688"]',
        '[class*="image"][class*="img"]',
        '.product-image',
        '.main-image',
        '.gallery-item',
        '[id*="image"]',
        '[id*="img"]'
      ];

      imageSelectors.forEach(selector => {
        $(selector).each((i, elem) => {
          const src = $(elem).attr('src');
          const dataSrc = $(elem).attr('data-src');
          const dataImage = $(elem).attr('data-image');
          
          if (src && (src.includes('alicdn') || src.includes('1688'))) {
            allImages.push({
              url: src,
              source: url,
              selector: selector,
              type: 'src'
            });
          }
          if (dataSrc && (dataSrc.includes('alicdn') || dataSrc.includes('1688'))) {
            allImages.push({
              url: dataSrc,
              source: url,
              selector: selector,
              type: 'data-src'
            });
          }
          if (dataImage && (dataImage.includes('alicdn') || dataImage.includes('1688'))) {
            allImages.push({
              url: dataImage,
              source: url,
              selector: selector,
              type: 'data-image'
            });
          }
        });
      });

      // Search for JSON data containing images
      const htmlContent = response.data;
      const jsonPatterns = [
        /offerImgList\s*[:=]\s*(\[[^\]]+\])/g,
        /imageList\s*[:=]\s*(\[[^\]]+\])/g,
        /gallery\s*[:=]\s*(\[[^\]]+\])/g,
        /"images"\s*[:]\s*(\[[^\]]+\])/g,
        /"img"\s*[:]\s*"([^"]+)"/g,
        /"url"\s*[:]\s*"([^"]+\.(jpg|jpeg|png|webp|gif)[^"]*)"/g
      ];

      jsonPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(htmlContent)) !== null) {
          if (match[1]) {
            try {
              // Try to parse as JSON array
              const images = JSON.parse(match[1]);
              if (Array.isArray(images)) {
                images.forEach(img => {
                  if (typeof img === 'string' && (img.includes('alicdn') || img.includes('1688'))) {
                    allImages.push({
                      url: img,
                      source: url,
                      type: 'json-array',
                      pattern: pattern.toString()
                    });
                  } else if (typeof img === 'object' && img.url) {
                    allImages.push({
                      url: img.url,
                      source: url,
                      type: 'json-object',
                      pattern: pattern.toString()
                    });
                  }
                });
              }
            } catch (e) {
              // If not JSON, treat as string
              if (match[1].includes('alicdn') || match[1].includes('1688')) {
                allImages.push({
                  url: match[1],
                  source: url,
                  type: 'string-match',
                  pattern: pattern.toString()
                });
              }
            }
          }
        }
      });

      // Search for image URLs in script tags
      $('script').each((i, elem) => {
        const scriptContent = $(elem).html();
        if (scriptContent) {
          const imageUrls = scriptContent.match(/https:\/\/[^\s"]*\.(jpg|jpeg|png|webp|gif)/g);
          if (imageUrls) {
            imageUrls.forEach(imgUrl => {
              if (imgUrl.includes('alicdn') || imgUrl.includes('1688')) {
                allImages.push({
                  url: imgUrl,
                  source: url,
                  type: 'script-tag',
                  selector: `script[${i}]`
                });
              }
            });
          }
        }
      });
    }

    // Filter and deduplicate images
    const uniqueImages = [];
    const seenUrls = new Set();
    
    allImages.forEach(img => {
      if (!seenUrls.has(img.url) && 
          img.url.length > 30 && 
          !img.url.includes('icon') && 
          !img.url.includes('logo') && 
          !img.url.includes('sprites')) {
        seenUrls.add(img.url);
        uniqueImages.push(img);
      }
    });

    console.log(`\n📊 Found ${uniqueImages.length} unique product images:`);
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img.url} (from ${img.source})`);
    });

    // Update the main extractor with real images
    if (uniqueImages.length > 0) {
      const realImageUrls = uniqueImages.map(img => img.url);
      
      // Read the existing JSON data
      const existingData = JSON.parse(fs.readFileSync('lamei-mobile-data.json', 'utf8'));
      
      // Update with real images
      existingData.main_images = realImageUrls.slice(0, 8); // Limit to 8 images max
      
      // Save updated data
      fs.writeFileSync('lamei-real-data.json', JSON.stringify(existingData, null, 2));
      console.log('\n💾 Updated with real images: lamei-real-data.json');
      
      console.log('\n🎯 UPDATED PRODUCT DATA WITH REAL IMAGES:');
      console.log(JSON.stringify(existingData, null, 2));
    } else {
      console.log('\n❌ No real images found. Using fallback approach...');
      
      // Use the main image we found earlier
      const mainImage = 'https://img.alicdn.com/imgextra/i2/O1CN01iHx1w01kMSG8GAKGe_!!6000000004669-2-tps-752-752.png';
      
      const existingData = JSON.parse(fs.readFileSync('lamei-mobile-data.json', 'utf8'));
      existingData.main_images = [mainImage];
      
      fs.writeFileSync('lamei-real-data.json', JSON.stringify(existingData, null, 2));
      console.log('\n💾 Updated with main image: lamei-real-data.json');
    }

  } catch (error) {
    console.error('❌ Error extracting real images:', error.message);
  }
}

// Run the extraction
extractLameiRealImages();