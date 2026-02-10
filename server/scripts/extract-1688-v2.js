import axios from 'axios';
import * as cheerio from 'cheerio';

async function extract1688ProductV2() {
  console.log('=== 1688 Product Data Extractor V2 ===');
  
  const productUrl = 'https://detail.1688.com/offer/844365442156.html?offerId=844365442156&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5621778968028&forcePC=1769590912978';
  
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
    console.log('🌐 Fetching product page...');
    
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
    
    console.log('✅ Page loaded successfully!');
    console.log('📄 HTML length:', response.data.length, 'characters');
    
    const $ = cheerio.load(response.data);
    
    // Extract basic information
    const title = $('title').text().replace(' - 阿里巴巴', '').trim();
    console.log('📦 Title:', title);
    
    // Extract price with multiple methods
    const price = extractPrice($) || findPriceInJavaScript(response.data);
    console.log('💰 Price:', price || 'Not found');
    
    // Extract images with better selectors
    const images = extractAllImages($);
    console.log('🖼️ Images found:', images.length);
    
    // Extract product details
    const details = extractProductDetails($);
    console.log('📋 Product details:', Object.keys(details).length, 'attributes');
    
    // Try to find seller information
    const seller = extractSellerInfo($);
    console.log('🏪 Seller:', seller || 'Not found');
    
    // Look for variant information
    const variants = findVariants(response.data);
    console.log('🎨 Variants found:', variants ? 'Yes' : 'No');
    
    return {
      product_name: title,
      category: inferCategory(title),
      main_images: images,
      url: productUrl,
      product_details: details,
      general_price: price,
      variants: variants || { sizes: [], colors: [] },
      offerId: 673586608661,
      seller: seller,
      success: true,
      raw_data_present: response.data.length > 100000 ? 'Rich content' : 'Basic page'
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
    '.detail-price',
    '.price-range',
    '.range-price'
  ];
  
  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim();
    if (priceText && /[0-9]/.test(priceText)) {
      const cleanPrice = priceText.replace(/[^0-9.]/g, '');
      if (cleanPrice) return cleanPrice;
    }
  }
  
  return null;
}

function extractAllImages($) {
  const images = [];
  
  const imageSelectors = [
    'img[src*="alicdn"]',
    'img[src*="1688"]',
    'img[src*="tbcdn"]',
    '.image-view img',
    '.product-image img',
    '.detail-img img',
    '.main-img',
    '.thumb-img',
    '.sku-image',
    '.offer-image',
    'img[data-src]',
    'img[original-src]'
  ];
  
  imageSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      let src = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('original-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (src.includes('http') && !images.includes(src)) {
          // Filter out logos and icons
          if (!src.includes('logo') && !src.includes('icon') && !src.includes('placeholder')) {
            images.push(src);
          }
        }
      }
    });
  });
  
  return images;
}

function extractProductDetails($) {
  const details = {};
  
  // Look for detail tables
  const detailTables = $('.spec-table, .detail-table, .product-detail, .offer-detail');
  
  detailTables.find('tr, .spec-item, .detail-item').each((i, elem) => {
    const key = $(elem).find('th, .spec-name, .detail-name').text().trim();
    const value = $(elem).find('td, .spec-value, .detail-value').text().trim();
    
    if (key && value && key.length < 50 && value.length < 100) {
      details[key] = value;
    }
  });
  
  return details;
}

function extractSellerInfo($) {
  const sellerSelectors = [
    '.seller-name',
    '.company-name',
    '.shop-name',
    '.supplier-name',
    '[data-spm="seller"]',
    '.offer-supplier'
  ];
  
  for (const selector of sellerSelectors) {
    const seller = $(selector).text().trim();
    if (seller && seller.length > 2) {
      return seller;
    }
  }
  
  return null;
}

function findPriceInJavaScript(html) {
  const pricePatterns = [
    /price[^:]*:[^\d]*([\d.,]+)/,
    /offerPrice[^:]*:[^\d]*([\d.,]+)/,
    /"price"[^:]*:[^\d]*([\d.,]+)/,
    /RMB[^\d]*([\d.,]+)/,
    /¥[^\d]*([\d.,]+)/,
    /rangePrice[^:]*:[^\[]*\[([^\]]+)\]/,
    /rangePrice\s*=\s*\[([^\]]+)\]/,
    /skuPrice[^:]*:[^\d]*([\d.,]+)/
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].replace(/[^0-9.]/g, '');
    }
  }
  
  return null;
}

function findVariants(html) {
  // Look for variant data in JavaScript
  const variantPatterns = [
    /skuJson\s*=\s*({[^}]+})/,
    /skuMap\s*=\s*({[^}]+})/,
    /variants\s*=\s*\[([^\]]+)\]/,
    /skuList\s*=\s*\[([^\]]+)\]/
  ];
  
  for (const pattern of variantPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        console.log('Could not parse variant JSON');
      }
    }
  }
  
  return null;
}

function inferCategory(title) {
  if (title.includes('T恤') || title.includes('上衣')) return '服装 > 女装 > T恤/上衣';
  if (title.includes('打底衫')) return '服装 > 女装 > 打底衫';
  if (title.includes('连衣裙')) return '服装 > 女装 > 连衣裙';
  return '服装 > 女装';
}

// Run the extraction
extract1688ProductV2()
  .then(result => {
    if (result.success) {
      console.log('\n✅ Extraction complete!');
      console.log('Raw data type:', result.raw_data_present);
      console.log('\n📋 Final product data:');
      console.log(JSON.stringify({
        products: [result]
      }, null, 2));
    } else {
      console.log('❌ Extraction failed:', result.error);
    }
  })
  .catch(error => {
    console.error('Failed to extract product data:', error.message);
  });