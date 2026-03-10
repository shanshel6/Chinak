import axios from 'axios';
import * as cheerio from 'cheerio';

async function get1688Product() {
  console.log('=== 1688 Product Data Extractor ===');
  
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
    
    const $ = cheerio.load(response.data);
    
    // Extract product information matching your JSON structure
    const productData = {
      product_name: $('title').text().replace(' - 阿里巴巴', '').trim(),
      category: extractCategory($),
      main_images: extractImages($),
      url: productUrl,
      product_details: extractProductDetails($),
      weight: extractWeight($),
      dimensions: extractDimensions($),
      reviews: extractReviews($),
      domestic_shipping_fee: extractDomesticShippingFee($),
      general_price: extractPrice($),
      variants: extractVariants($),
      generated_options: generateOptions($),
      extracted_tags: extractTags($),
      synonyms: extractSynonyms($),
      category_suggestion: extractCategorySuggestion($),
      offerId: 991775818085,
      seller: '广州易欣服饰'
    };
    
    console.log('\n🎯 PRODUCT DATA EXTRACTED:');
    console.log('================================');
    console.log('📦 Product Name:', productData.product_name);
    console.log('🏪 Seller:', productData.seller);
    console.log('💰 General Price:', productData.general_price || 'Not found');
    console.log('🚚 Domestic Shipping:', productData.domestic_shipping_fee || 'Not found');
    console.log('🖼️ Main Images:', productData.main_images.length);
    console.log('📏 Weight:', productData.weight || 'Not found');
    console.log('📐 Dimensions:', productData.dimensions || 'Not found');
    
    if (productData.main_images.length > 0) {
      console.log('   Main image:', productData.main_images[0]);
    }
    
    // If price not found in HTML, try to find in JavaScript data
    if (!productData.general_price) {
      const jsPrice = findPriceInJavaScript(response.data);
      if (jsPrice) {
        console.log('💰 Price (from JS):', jsPrice);
        productData.general_price = jsPrice;
      }
    }
    
    console.log('\n📋 Full data available in productData object');
    
    return productData;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

function extractPrice($) {
  // Multiple price selector patterns for 1688
  const priceSelectors = [
    '.price-value',
    '.sku-price',
    '.price',
    '[data-spm="dprice"]',
    '.b2b-price',
    '.offer-price',
    '.rmb',
    'span.price',
    'div.price'
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
  
  // Multiple image selector patterns
  const imageSelectors = [
    'img.main-img',
    'img[src*="1688"]',
    'img[src*="alicdn"]',
    '.image-view img',
    '.product-image img',
    '.detail-img img'
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

function extractShippingInfo($) {
  const shippingSelectors = [
    '.delivery-price',
    '.freight-price',
    '.shipping-cost',
    '.freight',
    '[data-spm="dfreight"]'
  ];
  
  for (const selector of shippingSelectors) {
    const shippingText = $(selector).text().trim();
    if (shippingText && /[0-9]/.test(shippingText)) {
      return shippingText;
    }
  }
  
  return null;
}

function extractMetadata(html) {
  const metadata = {};
  
  // Look for meta tags
  const metaPatterns = {
    description: /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
    keywords: /<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["']/i
  };
  
  for (const [key, pattern] of Object.entries(metaPatterns)) {
    const match = html.match(pattern);
    if (match && match[1]) {
      metadata[key] = match[1];
    }
  }
  
  return metadata;
}

function findPriceInJavaScript(html) {
  // Look for price patterns in JavaScript code
  const pricePatterns = [
    /price[^:]*:[^\d]*([\d.,]+)/,
    /offerPrice[^:]*:[^\d]*([\d.,]+)/,
    /"price"[^:]*:[^\d]*([\d.,]+)/,
    /RMB[^\d]*([\d.,]+)/,
    /¥[^\d]*([\d.,]+)/
  ];
  
  for (const pattern of pricePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

// New extraction functions for your JSON structure
function extractCategory($) {
  const categorySelectors = [
    '.category-path',
    '.breadcrumb',
    '.product-category',
    '[data-spm="dcategory"]'
  ];
  
  for (const selector of categorySelectors) {
    const categoryText = $(selector).text().trim();
    if (categoryText) {
      return categoryText;
    }
  }
  
  return 'الفئة المستنتجة';
}

function extractProductDetails($) {
  const details = {};
  
  // Look for product details tables or sections
  const detailSections = $('.product-detail, .spec-table, .detail-table');
  
  if (detailSections.length > 0) {
    detailSections.find('tr, .spec-item').each((i, elem) => {
      const key = $(elem).find('th, .spec-name').text().trim();
      const value = $(elem).find('td, .spec-value').text().trim();
      
      if (key && value) {
        details[key] = value;
      }
    });
  }
  
  // If no details found, return default structure
  if (Object.keys(details).length === 0) {
    return {
      "المادة": "الخامة المترجمة",
      "النمط": "الستايل المترجم", 
      "الموسم": "الموسم المترجم"
    };
  }
  
  return details;
}

function extractWeight($) {
  const weightPatterns = [
    /重量[^\d]*(\d+\.?\d*)/,
    /weight[^\d]*(\d+\.?\d*)/i,
    /(\d+\.?\d*)[^\d]*克/,
    /(\d+\.?\d*)[^\d]*g/
  ];
  
  const text = $('body').text();
  for (const pattern of weightPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return '0.25';
}

function extractDimensions($) {
  const dimensionPatterns = [
    /尺寸[^\d]*(\d+)[^\d]*(\d+)[^\d]*(\d+)/,
    /dimension[^\d]*(\d+)[^\d]*(\d+)[^\d]*(\d+)/i,
    /(\d+)[^\d]*(\d+)[^\d]*(\d+)[^\d]*cm/
  ];
  
  const text = $('body').text();
  for (const pattern of dimensionPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[2] && match[3]) {
      return `${match[1]}*${match[2]}*${match[3]}`;
    }
  }
  
  return 'الطول*العرض*الارتفاع';
}

function extractReviews($) {
  const reviews = [];
  
  // Look for review sections
  const reviewElements = $('.review-item, .comment-item, .feedback-item');
  
  if (reviewElements.length > 0) {
    reviewElements.each((i, elem) => {
      const review = {
        buyer: $(elem).find('.buyer-name, .user-name').text().trim() || 'اسم المشتري أو مجهول',
        comment: $(elem).find('.comment-text, .review-content').text().trim() || 'التعليق المترجم',
        date: $(elem).find('.review-date, .comment-time').text().trim() || 'التاريخ',
        spec: $(elem).find('.spec-info, .product-spec').text().trim() || 'المواصفات التي اشتراها'
      };
      
      reviews.push(review);
    });
  }
  
  // If no reviews found, return default review
  if (reviews.length === 0) {
    return [{
      buyer: 'اسم المشتري أو مجهول',
      comment: 'التعليق المترجم',
      date: 'التاريخ',
      spec: 'المواصفات التي اشتراها'
    }];
  }
  
  return reviews;
}

function extractDomesticShippingFee($) {
  const shippingPatterns = [
    /国内运费[^\d]*(\d+)/,
    /domestic[^\d]*shipping[^\d]*(\d+)/i,
    /运费[^\d]*(\d+)/
  ];
  
  const text = $('body').text();
  for (const pattern of shippingPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1]);
    }
  }
  
  return 600;
}

function extractVariants($) {
  // Look for variant options
  const sizeOptions = $('.size-option, .spec-size').map((i, el) => $(el).text().trim()).get();
  const colorOptions = $('.color-option, .spec-color').map((i, el) => $(el).text().trim()).get();
  
  return {
    sizes: sizeOptions.length > 0 ? sizeOptions : ["S", "M", "L"],
    colors: colorOptions.length > 0 ? colorOptions : ["أبيض", "أسود"]
  };
}

function generateOptions($) {
  const variants = extractVariants($);
  
  return [{
    color: variants.colors[0] || "أبيض",
    sizes: variants.sizes,
    price: extractPrice($) || 5000
  }];
}

function extractTags($) {
  // Look for tags or keywords
  const tagElements = $('.tag-item, .keyword, .product-tag');
  const tags = tagElements.map((i, el) => $(el).text().trim()).get();
  
  return tags.length > 0 ? tags : ["تاك 1", "تاك 2", "تاك 3"];
}

function extractSynonyms($) {
  // Look for search terms or related keywords
  const synonymPatterns = [
    /search[^:]*:[^\[]*\[([^\]]+)\]/i,
    /keyword[^:]*:[^\[]*\[([^\]]+)\]/i
  ];
  
  const text = $('body').text();
  for (const pattern of synonymPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].split(',').map(s => s.trim());
    }
  }
  
  return ["كلمة بحث 1", "كلمة بحث 2", "مصطلح عراقي"];
}

function extractCategorySuggestion($) {
  const category = extractCategory($);
  return category !== 'الفئة المستنتجة' ? category : 'اقتراح الفئة النهائي';
}

// Run the extraction
get1688Product()
  .then(productData => {
    console.log('\n✅ Extraction complete!');
    console.log('Use this data to create your product import.');
  })
  .catch(error => {
    console.error('Failed to extract product data:', error.message);
  });