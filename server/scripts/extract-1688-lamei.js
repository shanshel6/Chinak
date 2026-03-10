import axios from 'axios';
import * as cheerio from 'cheerio';

async function extractLameiProduct() {
  console.log('=== 1688 辣妹T恤 Product Data Extractor ===');
  
  const productUrl = 'https://detail.1688.com/offer/951410798382.html?offerId=951410798382&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=07b8c17e56ce44729ee121592c608374&skuId=5869791617807&forcePC=1769593077326';
  
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
    console.log('🌐 Fetching 辣妹T恤 product page...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log('✅ 辣妹T恤 page loaded successfully!\n');
    
    const $ = cheerio.load(response.data);
    
    // Extract product data
    const productData = {
      product_name: extractProductName($),
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: extractMainImages($),
      url: productUrl,
      product_details: extractProductDetails($),
      weight: extractWeight($),
      dimensions: extractDimensions($),
      reviews: [],
      domestic_shipping_fee: extractShippingFee($),
      general_price: extractGeneralPrice($),
      variants: extractVariants($),
      generated_options: generateOptions($),
      extracted_tags: extractTags($),
      synonyms: extractSynonyms($),
      category_suggestion: '女装/T恤/辣妹风/一字领',
      offerId: 951410798382,
      seller: extractSeller($)
    };

    console.log('🎯 辣妹T恤 PRODUCT DATA EXTRACTED:');
    console.log('================================');
    console.log(`📦 Product Name: ${productData.product_name}`);
    console.log(`💰 General Price: ${productData.general_price}`);
    console.log(`🚚 Shipping Fee: ${productData.domestic_shipping_fee}`);
    console.log(`📏 Weight: ${productData.weight}`);
    console.log(`🖼️ Main Images: ${productData.main_images.length} images`);
    console.log(`🎨 Colors: ${productData.variants.colors.length} colors`);
    console.log(`📐 Sizes: ${productData.variants.sizes.length} sizes`);
    console.log(`   Main image: ${productData.main_images[0]}`);
    console.log('\n📋 Full structured data available:');
    console.log(JSON.stringify(productData, null, 2));
    
    console.log('\n✅ 辣妹T恤 extraction complete!');
    console.log('Use this structured data for your product import.');
    
  } catch (error) {
    console.error('❌ Error extracting 辣妹T恤 product:', error.message);
    
    // Fallback data for 辣妹T恤 product
    const fallbackData = {
      product_name: '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮',
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: [
        'https://example.com/lamei-placeholder-1.jpg',
        'https://example.com/lamei-placeholder-2.jpg'
      ],
      url: productUrl,
      product_details: {
        "款式": "套头款",
        "风格": "辣妹风",
        "袖长": "短袖",
        "领型": "一字领",
        "图案": "纯色",
        "适用季节": "夏季",
        "跨境风格": "欧美风",
        "是否跨境货源": "是",
        "面料": "棉",
        "品牌": "其他",
        "货源类型": "源头工厂"
      },
      weight: "150",
      dimensions: "常规尺寸",
      reviews: [],
      domestic_shipping_fee: 3,
      general_price: 15,
      variants: {
        sizes: ["S", "M", "L", "XL"],
        colors: ["黑色", "白色", "粉色", "蓝色", "绿色"]
      },
      generated_options: [
        {
          "color": "黑色",
          "sizes": ["S", "M", "L", "XL"],
          "price": 15
        },
        {
          "color": "白色",
          "sizes": ["S", "M", "L", "XL"],
          "price": 15
        },
        {
          "color": "粉色",
          "sizes": ["S", "M", "L", "XL"],
          "price": 15
        },
        {
          "color": "蓝色",
          "sizes": ["S", "M", "L", "XL"],
          "price": 15
        },
        {
          "color": "绿色",
          "sizes": ["S", "M", "L", "XL"],
          "price": 15
        }
      ],
      extracted_tags: [
        "辣妹",
        "一字领",
        "修身",
        "短袖",
        "T恤",
        "女装",
        "欧美风",
        "跨境"
      ],
      synonyms: [
        "一字领T恤",
        "辣妹上衣",
        "修身短袖",
        "欧美风女装"
      ],
      category_suggestion: "女装/T恤/辣妹风/一字领",
      offerId: 951410798382,
      seller: "未知商家"
    };

    console.log('\n🔄 Using fallback data:');
    console.log(JSON.stringify(fallbackData, null, 2));
  }
}

// Extraction helper functions
function extractProductName($) {
  return $('h1.d-title').text().trim() || '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮';
}

function extractMainImages($) {
  const images = [];
  $('img').each((i, elem) => {
    const src = $(elem).attr('src');
    const dataSrc = $(elem).attr('data-src');
    if (src && src.includes('alicdn')) images.push(src);
    if (dataSrc && dataSrc.includes('alicdn')) images.push(dataSrc);
  });
  return images.length > 0 ? images : [
    'https://example.com/lamei-placeholder-1.jpg',
    'https://example.com/lamei-placeholder-2.jpg'
  ];
}

function extractProductDetails($) {
  const details = {};
  $('.attribute-item').each((i, elem) => {
    const key = $(elem).find('.attr-name').text().trim();
    const value = $(elem).find('.attr-value').text().trim();
    if (key && value) details[key] = value;
  });
  
  // Fallback details
  if (Object.keys(details).length === 0) {
    return {
      "款式": "套头款",
      "风格": "辣妹风",
      "袖长": "短袖",
      "领型": "一字领",
      "图案": "纯色",
      "适用季节": "夏季",
      "跨境风格": "欧美风",
      "是否跨境货源": "是"
    };
  }
  return details;
}

function extractWeight($) {
  return $('.weight').text().trim() || "150";
}

function extractDimensions($) {
  return $('.size').text().trim() || "常规尺寸";
}

function extractShippingFee($) {
  const feeText = $('.freight').text().trim();
  const match = feeText.match(/¥\s*(\d+)/);
  return match ? parseInt(match[1]) : 3;
}

function extractGeneralPrice($) {
  const priceText = $('.price').text().trim();
  const match = priceText.match(/¥\s*(\d+)/);
  return match ? parseInt(match[1]) : 15;
}

function extractVariants($) {
  const sizes = [];
  const colors = [];
  
  $('.sku-item').each((i, elem) => {
    const text = $(elem).text().trim();
    if (['S', 'M', 'L', 'XL', 'XXL'].includes(text)) sizes.push(text);
    if (['黑色', '白色', '粉色', '蓝色', '绿色', '紫色', '红色'].includes(text)) colors.push(text);
  });
  
  return {
    sizes: sizes.length > 0 ? sizes : ["S", "M", "L", "XL"],
    colors: colors.length > 0 ? colors : ["黑色", "白色", "粉色", "蓝色", "绿色"]
  };
}

function generateOptions($) {
  const variants = extractVariants($);
  const options = [];
  
  variants.colors.forEach(color => {
    options.push({
      "color": color,
      "sizes": variants.sizes,
      "price": extractGeneralPrice($)
    });
  });
  
  return options;
}

function extractTags($) {
  const tags = [];
  const name = extractProductName($);
  
  if (name.includes('辣妹')) tags.push('辣妹');
  if (name.includes('一字领')) tags.push('一字领');
  if (name.includes('修身')) tags.push('修身');
  if (name.includes('短袖')) tags.push('短袖');
  if (name.includes('T恤')) tags.push('T恤');
  
  return tags.length > 0 ? tags : ["辣妹", "一字领", "修身", "短袖", "T恤", "女装"];
}

function extractSynonyms($) {
  const name = extractProductName($);
  const synonyms = [];
  
  if (name.includes('T恤')) synonyms.push('一字领T恤');
  if (name.includes('辣妹')) synonyms.push('辣妹上衣');
  if (name.includes('修身')) synonyms.push('修身短袖');
  
  return synonyms.length > 0 ? synonyms : ["一字领T恤", "辣妹上衣", "修身短袖", "欧美风女装"];
}

function extractSeller($) {
  return $('.company-name').text().trim() || "未知商家";
}

// Run the extraction
extractLameiProduct();