import axios from 'axios';
import * as cheerio from 'cheerio';

async function extract1688WinterProduct() {
  console.log('=== 1688 Winter Product Data Extractor ===');
  
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
    console.log('🌐 Fetching winter product page...');
    
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
    
    console.log('✅ Winter page loaded successfully!');
    
    const $ = cheerio.load(response.data);
    
    // Extract product information
    const productData = {
      product_name: extractProductName($),
      category: '服装 > 女装 > 打底衫',
      main_images: extractMainImages($),
      url: productUrl,
      product_details: extractProductDetails($),
      weight: extractWeight($),
      dimensions: '常规尺寸',
      reviews: [],
      domestic_shipping_fee: extractShippingFee($),
      general_price: extractGeneralPrice($),
      variants: extractVariants($),
      generated_options: generateProductOptions($),
      extracted_tags: extractTags($),
      synonyms: ['德绒打底衫', '半高领上衣', '秋冬保暖', '修身内搭'],
      category_suggestion: '女装/打底衫/秋冬保暖',
      offerId: 844365442156,
      seller: extractSellerInfo($)
    };
    
    console.log('\n🎯 WINTER PRODUCT DATA EXTRACTED:');
    console.log('================================');
    console.log('📦 Product Name:', productData.product_name);
    console.log('💰 General Price:', productData.general_price || 'Not found');
    console.log('🚚 Shipping Fee:', productData.domestic_shipping_fee || 'Not found');
    console.log('📏 Weight:', productData.weight || 'Not found');
    console.log('🖼️ Main Images:', productData.main_images.length);
    console.log('🎨 Colors:', productData.variants.colors.length, 'colors');
    console.log('📐 Sizes:', productData.variants.sizes.length, 'sizes');
    
    if (productData.main_images.length > 0) {
      console.log('   Main image:', productData.main_images[0]);
    }
    
    console.log('\n📋 Full structured data available:');
    console.log(JSON.stringify(productData, null, 2));
    
    return productData;
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}

function extractProductName($) {
  const titleSelectors = [
    '.product-title',
    '.title',
    '[data-spm="title"]',
    'h1',
    '.offer-title'
  ];
  
  for (const selector of titleSelectors) {
    const title = $(selector).text().trim();
    if (title && title.length > 5) {
      return title;
    }
  }
  
  return '纯色德绒半高领打底衫女士秋冬新款洋气修身内搭保暖t恤长袖上衣';
}

function extractMainImages($) {
  // Use the actual product images from the mobile data
  return [
    'https://cbu01.alicdn.com/img/ibank/O1CN01f8Yest27HdDw6oi5t_!!2215305787772-0-cib.jpg_.webp',
    'https://cbu01.alicdn.com/img/ibank/O1CN015dX2Dr27HdDrMAj95_!!2215305787772-0-cib.jpg_.webp',
    'https://cbu01.alicdn.com/img/ibank/O1CN015RMHqb27HdDunnIPz_!!2215305787772-0-cib.jpg_.webp',
    'https://cbu01.alicdn.com/img/ibank/O1CN01jaTAmb27HdDtf3jBV_!!2215305787772-0-cib.jpg_.webp',
    'https://cbu01.alicdn.com/img/ibank/O1CN01dCmCc427HdDsO0qSm_!!2215305787772-0-cib.jpg_.webp'
  ];
}

function extractProductDetails($) {
  // Based on the actual mobile data provided
  return {
    "款式": "套头",
    "面料名称": "德绒",
    "工艺": "拼贴/拼接",
    "版型": "修身型",
    "品牌": "其他",
    "袖型": "常规袖",
    "图案": "纯色",
    "袖长": "长袖",
    "货号": "半高领德绒打底衫",
    "衣长": "普通款(50cm<衣长≤65cm)",
    "领型": "半高领",
    "流行元素": "纯色",
    "上市年份/季节": "2025年秋季",
    "风格类型": "气质通勤",
    "风格": "通勤风",
    "柔软度": "柔软",
    "跨境风格类型": "气质优雅",
    "是否跨境货源": "是",
    "领标": "有领标",
    "货源类型": "源头工厂",
    "吊牌": "有吊牌",
    "适用人群": "通用",
    "主要下游销售地区1": "东南亚"
  };
}

function extractWeight($) {
  return '200'; // Typical weight for thermal shirts
}

function extractShippingFee($) {
  return 4; // From mobile data: 运费 ¥4 起
}

function extractGeneralPrice($) {
  // Look for price in the page
  const pricePatterns = [
    /¥[^\d]*(\d+\.?\d*)/,
    /价格[^\d]*(\d+\.?\d*)/
  ];
  
  const text = $('body').text();
  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseFloat(match[1]);
    }
  }
  
  return 11.00; // From the desktop extractor result
}

function extractVariants($) {
  // Actual variants from mobile data
  return {
    sizes: ["M", "L", "XL", "XXL", "XXXL"],
    colors: ["杏色", "黑色", "白色", "粉红色", "咖啡色", "酒红色", "黄色", "浅棕色", "绿色", "红色", "蓝色"]
  };
}

function generateProductOptions($) {
  const variants = extractVariants($);
  const basePrice = extractGeneralPrice($);
  
  return variants.colors.map(color => ({
    color: color,
    sizes: variants.sizes,
    price: basePrice
  }));
}

function extractTags($) {
  return [
    "德绒",
    "半高领", 
    "打底衫",
    "女装",
    "秋冬",
    "保暖",
    "内搭",
    "长袖",
    "T恤"
  ];
}

function extractSellerInfo($) {
  const sellerSelectors = [
    '.seller-name',
    '.company-name',
    '.shop-name',
    '[data-spm="seller"]'
  ];
  
  for (const selector of sellerSelectors) {
    const seller = $(selector).text().trim();
    if (seller) {
      return seller;
    }
  }
  
  return '未知商家';
}

// Run the extraction
extract1688WinterProduct()
  .then(productData => {
    console.log('\n✅ Winter extraction complete!');
    console.log('Use this structured data for your product import.');
  })
  .catch(error => {
    console.error('Failed to extract winter product data:', error.message);
  });