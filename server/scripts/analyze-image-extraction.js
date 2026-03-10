import axios from 'axios';
import * as cheerio from 'cheerio';

async function analyzeImageExtraction() {
  console.log('=== ANALYZING IMAGE EXTRACTION ISSUES ===');
  
  const testUrls = [
    'https://detail.1688.com/offer/951410798382.html?offerId=951410798382&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5869791617807&forcePC=1769593077326',
    'https://detail.1688.com/offer/863185095565.html?offerId=863185095565&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5687254561570&forcePC=1769594105037'
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

  for (const url of testUrls) {
    console.log(`\n🔍 Analyzing: ${url}`);
    
    try {
      const response = await axios.get(url, {
        headers: { 
          'Cookie': cookies, 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Analyze different image sources
      console.log('📊 Image Analysis:');
      
      // 1. Main product images
      const mainImages = $('img[src*="alicdn"], img[data-src*="alicdn"]');
      console.log(`   Main product images found: ${mainImages.length}`);
      
      // 2. Gallery/slider images
      const galleryImages = $('.image-item img, .gallery img, .slider img');
      console.log(`   Gallery images found: ${galleryImages.length}`);
      
      // 3. All images with alicdn
      const allAlicdnImages = $('img[src*="alicdn"], img[data-src*="alicdn"]');
      console.log(`   All alicdn images: ${allAlicdnImages.length}`);
      
      // 4. Check for JSON data in scripts
      const scripts = $('script');
      let jsonImageCount = 0;
      scripts.each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent && scriptContent.includes('imageList') && scriptContent.includes('alicdn')) {
          jsonImageCount++;
        }
      });
      console.log(`   JSON image data in scripts: ${jsonImageCount}`);
      
      // Show actual image URLs found
      console.log('🖼️ Actual image URLs found:');
      allAlicdnImages.each((i, el) => {
        if (i < 5) { // Show first 5
          const src = $(el).attr('src') || $(el).attr('data-src');
          console.log(`   ${i+1}. ${src}`);
        }
      });
      
    } catch (error) {
      console.error(`❌ Error analyzing ${url}:`, error.message);
    }
  }
}

analyzeImageExtraction();