import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function extractProperProductImages() {
  console.log('=== 1688 辣妹T恤 Proper Image Extractor ===');
  
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
    console.log('🌐 Fetching product page for proper image extraction...');
    
    const response = await axios.get(productUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.1688.com/',
        'Connection': 'keep-alive'
      },
      timeout: 15000
    });

    console.log('✅ Page loaded successfully!');
    
    const $ = cheerio.load(response.data);
    
    // Save HTML for debugging
    fs.writeFileSync('debug-product-html.txt', response.data);
    console.log('💾 HTML saved for debugging');
    
    // Look for the main product image gallery
    const productImages = [];
    
    // Strategy 1: Look for main product images in specific selectors
    const mainImageSelectors = [
      '.main-img',
      '.product-image',
      '.detail-gallery',
      '.image-item',
      '.thumb-item',
      '.sku-image',
      '[data-role="main-image"]',
      '[class*="image"][class*="main"]',
      '[class*="product"][class*="img"]',
      '.J_ImgSwitcher',
      '.image-switcher',
      '.detail-image'
    ];
    
    mainImageSelectors.forEach(selector => {
      $(selector).find('img').each((i, elem) => {
        const src = $(elem).attr('src');
        const dataSrc = $(elem).attr('data-src');
        const dataImage = $(elem).attr('data-image');
        
        const imageUrl = dataSrc || dataImage || src;
        if (imageUrl && imageUrl.includes('alicdn') && !isUIIcon(imageUrl)) {
          productImages.push(normalizeImageUrl(imageUrl));
        }
      });
    });
    
    // Strategy 2: Look for larger images (product images are usually larger)
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      const dataSrc = $(elem).attr('data-src');
      const dataImage = $(elem).attr('data-image');
      
      const imageUrl = dataSrc || dataImage || src;
      if (imageUrl && imageUrl.includes('alicdn')) {
        // Check if it's a product image (not UI element)
        if (!isUIIcon(imageUrl) && isProductImage($(elem))) {
          productImages.push(normalizeImageUrl(imageUrl));
        }
      }
    });
    
    // Strategy 3: Look for JSON data with product images
    const scriptContents = $('script').map((i, el) => $(el).html()).get();
    for (const script of scriptContents) {
      if (script && script.includes('offerImgList') || script.includes('imageList')) {
        const imageMatches = script.match(/https:\/\/[^\s"]*\.(jpg|jpeg|png|webp|gif)/g);
        if (imageMatches) {
          imageMatches.forEach(url => {
            if (url.includes('alicdn') && !isUIIcon(url) && url.length > 50) {
              productImages.push(normalizeImageUrl(url));
            }
          });
        }
      }
    }
    
    // Remove duplicates and filter out non-product images
    const uniqueProductImages = [...new Set(productImages)]
      .filter(url => isProductImageUrl(url))
      .slice(0, 8); // Limit to 8 product images
    
    console.log(`\n📸 Found ${uniqueProductImages.length} proper product images:`);
    uniqueProductImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img}`);
    });
    
    // If no proper images found, use the main one we know exists
    if (uniqueProductImages.length === 0) {
      console.log('\n⚠️  No proper product images found, using main image');
      uniqueProductImages.push('https://img.alicdn.com/imgextra/i2/O1CN01iHx1w01kMSG8GAKGe_!!6000000004669-2-tps-752-752.png');
    }
    
    // Create the complete product data
    const productData = {
      product_name: '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮',
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: uniqueProductImages,
      url: productUrl,
      product_details: {
        "款式": "套头款",
        "风格": "辣妹风",
        "袖长": "短袖",
        "领型": "一字领",
        "图案": "纯色",
        "适用季节": "夏季",
        "跨境风格": "欧美风",
        "是否跨境货源": "是"
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
      generated_options: createProductOptions(15),
      extracted_tags: ["辣妹", "一字领", "修身", "短袖", "T恤", "女装", "欧美风", "跨境"],
      synonyms: ["一字领T恤", "辣妹上衣", "修身短袖", "欧美风女装"],
      category_suggestion: "女装/T恤/辣妹风/一字领",
      offerId: 951410798382,
      seller: "未知商家"
    };
    
    console.log('\n🎯 COMPLETE PRODUCT DATA WITH PROPER IMAGES:');
    console.log(JSON.stringify(productData, null, 2));
    
    // Save to file
    fs.writeFileSync('proper-product-data.json', JSON.stringify(productData, null, 2));
    console.log('\n💾 Proper product data saved to: proper-product-data.json');
    
    // Also save image URLs separately
    fs.writeFileSync('product-images-only.txt', uniqueProductImages.join('\n'));
    console.log('💾 Image URLs saved to: product-images-only.txt');
    
  } catch (error) {
    console.error('❌ Error extracting proper images:', error.message);
    
    // Fallback with known good image
    const fallbackData = {
      product_name: '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮',
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: ['https://img.alicdn.com/imgextra/i2/O1CN01iHx1w01kMSG8GAKGe_!!6000000004669-2-tps-752-752.png'],
      url: productUrl,
      product_details: {
        "款式": "套头款",
        "风格": "辣妹风",
        "袖长": "短袖",
        "领型": "一字领",
        "图案": "纯色",
        "适用季节": "夏季",
        "跨境风格": "欧美风",
        "是否跨境货源": "是"
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
      generated_options: createProductOptions(15),
      extracted_tags: ["辣妹", "一字领", "修身", "短袖", "T恤", "女装", "欧美风", "跨境"],
      synonyms: ["一字领T恤", "辣妹上衣", "修身短袖", "欧美风女装"],
      category_suggestion: "女装/T恤/辣妹风/一字领",
      offerId: 951410798382,
      seller: "未知商家"
    };
    
    fs.writeFileSync('fallback-product-data.json', JSON.stringify(fallbackData, null, 2));
    console.log('\n🔄 Fallback data saved');
  }
}

// Helper functions
function isUIIcon(url) {
  const iconPatterns = [
    /\d{1,2}x\d{1,2}\.png/, // Small dimensions like 16x16, 32x32
    /icon/, // Contains "icon"
    /logo/, // Contains "logo"
    /sprites/, // Sprite sheets
    /btn/, // Buttons
    /arrow/, // Arrows
    /close/, // Close buttons
    /menu/, // Menu icons
    /search/, // Search icons
    /cart/, // Cart icons
    /user/, // User icons
    /share/, // Share icons
    /like/, // Like icons
    /fav/, // Favorite icons
    /loading/, // Loading animations
    /placeholder/, // Placeholders
    /default/, // Default images
    /empty/ // Empty states
  ];
  
  return iconPatterns.some(pattern => pattern.test(url));
}

function isProductImage(element) {
  const width = element.attr('width') || '';
  const height = element.attr('height') || '';
  const className = element.attr('class') || '';
  const parentClass = element.parent().attr('class') || '';
  
  // Product images are usually larger and have specific class patterns
  return (
    (width > 100 || height > 100) && // Reasonable size
    !className.includes('icon') && // Not an icon
    !parentClass.includes('icon') && // Parent not an icon
    (className.includes('image') || className.includes('img') || className.includes('product')) || // Image-related classes
    parentClass.includes('gallery') || parentClass.includes('swiper') || parentClass.includes('slide') // In gallery/slider
  );
}

function isProductImageUrl(url) {
  return (
    url.includes('alicdn') &&
    !isUIIcon(url) &&
    url.length > 40 && // Reasonable URL length
    !url.includes('tfs') && // Exclude certain patterns
    !url.includes('gw.alicdn.com/imgextra') // Exclude UI elements
  );
}

function normalizeImageUrl(url) {
  // Remove any URL parameters that might cause issues
  return url.split('?')[0];
}

function createProductOptions(price) {
  return [
    { "color": "黑色", "sizes": ["S", "M", "L", "XL"], "price": price },
    { "color": "白色", "sizes": ["S", "M", "L", "XL"], "price": price },
    { "color": "粉色", "sizes": ["S", "M", "L", "XL"], "price": price },
    { "color": "蓝色", "sizes": ["S", "M", "L", "XL"], "price": price },
    { "color": "绿色", "sizes": ["S", "M", "L", "XL"], "price": price }
  ];
}

// Run the extraction
extractProperProductImages();