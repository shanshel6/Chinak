import axios from 'axios';
import * as cheerio from 'cheerio';

async function extractDesktop1688Product() {
  console.log('=== Desktop 1688 Product Data Extractor ===');
  
  const productUrl = 'https://detail.1688.com/offer/673586608661.html?offerId=673586608661&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=4852801821189&forcePC=1769590197170';
  
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
    console.log('🌐 Fetching desktop product page...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      timeout: 15000,
    });
    
    console.log('✅ Desktop page loaded successfully!');
    
    const $ = cheerio.load(response.data);
    
    // Log HTML length for debugging
    console.log('📄 HTML length:', response.data.length, 'characters');
    
    // Extract basic information first
    const title = $('title').text().replace(' - 阿里巴巴', '').trim();
    console.log('📦 Page Title:', title);
    
    // Try to extract price
    const price = extractPrice($) || findPriceInJavaScript(response.data);
    console.log('💰 Price found:', price);
    
    // Try to extract images
    const images = extractImages($);
    console.log('🖼️ Images found:', images.length);
    
    if (images.length > 0) {
      console.log('   First image:', images[0]);
    }
    
    return {
      title: title,
      price: price,
      images: images,
      raw_html_length: response.data.length,
      success: true
    };
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

function extractPrice($) {
  const priceSelectors = [
    '.price-value',
    '.sku-price',
    '.price',
    '[data-spm="dprice"]',
    '.b2b-price',
    '.offer-price',
    '.rmb',
    'span.price',
    'div.price',
    '.mod-detail-price',
    '.detail-price'
  ];
  
  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim();
    if (priceText && /[0-9]/.test(priceText)) {
      return priceText;
    }
  }
  
  return null;
}

function extractImages($) {
  const images = [];
  
  const imageSelectors = [
    'img[src*="alicdn"]',
    'img[src*="1688"]',
    '.image-view img',
    '.product-image img',
    '.detail-img img',
    '.main-img',
    '.thumb-img'
  ];
  
  imageSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && (src.includes('http') || src.includes('//'))) {
        const fullUrl = src.startsWith('//') ? 'https:' + src : src;
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    });
  });
  
  return images;
}

function findPriceInJavaScript(html) {
  const pricePatterns = [
    /price[^:]*:[^\d]*([\d.,]+)/,
    /offerPrice[^:]*:[^\d]*([\d.,]+)/,
    /"price"[^:]*:[^\d]*([\d.,]+)/,
    /RMB[^\d]*([\d.,]+)/,
    /¥[^\d]*([\d.,]+)/,
    /rangePrice[^:]*:[^\[]*\[([^\]]+)\]/
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

// Run the extraction
extractDesktop1688Product()
  .then(result => {
    if (result.success) {
      console.log('\n✅ Desktop extraction complete!');
      console.log('Title:', result.title);
      console.log('Price:', result.price);
      console.log('Images:', result.images.length);
      console.log('HTML length:', result.raw_html_length, 'characters');
    } else {
      console.log('❌ Extraction failed:', result.error);
    }
  })
  .catch(error => {
    console.error('Failed to extract desktop product data:', error.message);
  });