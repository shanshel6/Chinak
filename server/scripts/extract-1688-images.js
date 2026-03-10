import axios from 'axios';
import * as cheerio from 'cheerio';

async function extract1688Images() {
  console.log('=== 1688 Image Extractor ===');
  
  const productUrl = 'https://detail.1688.com/offer/991775818085.html?offerId=991775818085&forcePC=1769586521761';
  
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
    console.log('🌐 Fetching product page for image analysis...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
      },
      timeout: 15000,
    });
    
    console.log('✅ Page loaded successfully!');
    
    const $ = cheerio.load(response.data);
    const html = response.data;
    
    console.log('\n🔍 Analyzing image patterns...');
    
    // Pattern 1: Direct image URLs from your examples
    const directImageUrls = [
      'https://cbu01.alicdn.com/img/ibank/O1CN01aeuace2GIqvEnJoeZ_!!2210505638993-0-cib.jpg',
      'https://cbu01.alicdn.com/img/ibank/O1CN01fLucya2GIqvE6DJNW_!!2210505638993-0-cib.jpg_.webp',
      'https://cbu01.alicdn.com/img/ibank/O1CN01eE9UdE2GIqvFH4HOK_!!2210505638993-0-cib.jpg_.webp',
      'https://cbu01.alicdn.com/img/ibank/O1CN01z7EB8J2GIqv9Q8oLB_!!2210505638993-0-cib.jpg_.webp'
    ];
    
    console.log('📸 Your provided image patterns:');
    directImageUrls.forEach((url, index) => {
      console.log(`  ${index + 1}. ${url}`);
    });
    
    // Extract all images using multiple strategies
    const allImages = extractAllImages($, html);
    
    console.log('\n🎯 IMAGE EXTRACTION RESULTS:');
    console.log('================================');
    console.log('🖼️ Total images found:', allImages.length);
    
    if (allImages.length > 0) {
      console.log('\n📋 All extracted images:');
      allImages.forEach((img, index) => {
        console.log(`  ${index + 1}. ${img}`);
      });
      
      // Filter to get only product images (similar to your examples)
      const productImages = filterProductImages(allImages, directImageUrls);
      
      console.log('\n🎯 PRODUCT IMAGES (filtered):');
      console.log('Found:', productImages.length, 'product images');
      
      productImages.forEach((img, index) => {
        console.log(`  ${index + 1}. ${img}`);
      });
    }
    
    return allImages;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

function extractAllImages($, html) {
  const images = new Set();
  
  // Strategy 1: Cheerio selectors
  const selectors = [
    'img[src*="alicdn"]',
    'img[src*="cbu01"]', 
    'img[src*="ibank"]',
    'img[src*="O1CN"]',
    '.image-view img',
    '.product-image img',
    '.detail-img img',
    '.main-img',
    '.sku-image',
    'img[data-src]',
    'img[src]'
  ];
  
  selectors.forEach(selector => {
    $(selector).each((i, elem) => {
      let src = $(elem).attr('src') || $(elem).attr('data-src');
      if (src) {
        src = normalizeImageUrl(src);
        if (isValidImageUrl(src)) {
          images.add(src);
        }
      }
    });
  });
  
  // Strategy 2: Regex patterns in HTML
  const regexPatterns = [
    /(https?:\/\/[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)/gi,
    /(\/\/[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)/gi,
    /(https?:\/\/cbu01\.alicdn\.com[^"']*)/gi,
    /(https?:\/\/img\.alicdn\.com[^"']*)/gi,
    /(O1CN[^"']*\.(?:jpg|jpeg|png|webp))/gi
  ];
  
  regexPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = normalizeImageUrl(match[1]);
      if (isValidImageUrl(url)) {
        images.add(url);
      }
    }
  });
  
  // Strategy 3: Look for JSON data with images
  const jsonPatterns = [
    /"image"[^:]*:[^\[]*\[([^\]]*)\]/g,
    /"images"[^:]*:[^\[]*\[([^\]]*)\]/g,
    /"img"[^:]*:[^\[]*\[([^\]]*)\]/g,
    /"url"[^:]*:[^"']*["']([^"']*\.(?:jpg|jpeg|png|webp))["']/g
  ];
  
  jsonPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        const urls = match[1].split(',').map(url => 
          normalizeImageUrl(url.replace(/["']/g, '').trim())
        );
        urls.forEach(url => {
          if (isValidImageUrl(url)) {
            images.add(url);
          }
        });
      }
    }
  });
  
  return Array.from(images);
}

function normalizeImageUrl(url) {
  if (!url) return '';
  
  // Remove query parameters and fragments
  url = url.split('?')[0].split('#')[0];
  
  // Ensure protocol
  if (url.startsWith('//')) {
    url = 'https:' + url;
  } else if (url.startsWith('/')) {
    url = 'https://detail.1688.com' + url;
  }
  
  // Remove trailing underscores and webp extensions that might be added
  url = url.replace(/\.jpg_\.webp$/, '.jpg');
  url = url.replace(/\.jpeg_\.webp$/, '.jpeg');
  url = url.replace(/\.png_\.webp$/, '.png');
  url = url.replace(/_\.webp$/, '');
  
  return url.trim();
}

function isValidImageUrl(url) {
  if (!url) return false;
  
  // Must be a valid URL
  if (!url.includes('://')) return false;
  
  // Must be from trusted domains
  const validDomains = [
    'alicdn.com',
    'cbu01.alicdn.com', 
    'img.alicdn.com',
    '1688.com'
  ];
  
  if (!validDomains.some(domain => url.includes(domain))) {
    return false;
  }
  
  // Must be an image file
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  if (!imageExtensions.some(ext => url.toLowerCase().includes(ext))) {
    return false;
  }
  
  // Should not be icons, logos, or other non-product images
  const excludePatterns = [
    'logo',
    'icon', 
    'spinner',
    'loading',
    'placeholder',
    'default',
    'avatar',
    '1x1',
    'pixel'
  ];
  
  if (excludePatterns.some(pattern => url.toLowerCase().includes(pattern))) {
    return false;
  }
  
  return true;
}

function filterProductImages(allImages, examplePatterns) {
  return allImages.filter(img => {
    // Check if image matches the pattern of your examples
    const isProductImage = examplePatterns.some(example => 
      img.includes('cbu01.alicdn.com/img/ibank/') &&
      img.includes('O1CN') &&
      img.includes('!!2210505638993')
    );
    
    // Also include other product-looking images
    const looksLikeProduct = (
      img.includes('O1CN') &&
      (img.includes('.jpg') || img.includes('.jpeg') || img.includes('.png')) &&
      !img.includes('logo') &&
      !img.includes('icon')
    );
    
    return isProductImage || looksLikeProduct;
  });
}

// Run the extraction
extract1688Images()
  .then(images => {
    console.log('\n✅ Image extraction complete!');
    console.log('Total unique images found:', images.length);
  })
  .catch(error => {
    console.error('Failed to extract images:', error.message);
  });