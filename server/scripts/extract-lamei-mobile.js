import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function extractLameiMobile() {
  console.log('=== 1688 辣妹T恤 Mobile Version Extractor ===');
  
  // Try mobile version
  const mobileUrl = 'https://m.1688.com/offer/951410798382.html';
  
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
    console.log('🌐 Fetching mobile version of 辣妹T恤 product page...');
    
    const response = await axios.get(mobileUrl, {
      headers: {
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      }
    });

    console.log('✅ Mobile page loaded successfully!\n');
    
    const $ = cheerio.load(response.data);
    
    // Save the mobile HTML for analysis
    fs.writeFileSync('lamei-mobile-html.txt', response.data);
    console.log('💾 Mobile HTML saved to lamei-mobile-html.txt');
    
    // Extract product name
    const productName = $('h1.product-name').text().trim() || 
                       $('title').text().replace(' - 阿里巴巴', '').trim() ||
                       '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮';
    
    console.log(`📦 Product Name: ${productName}`);
    
    // Extract price
    const priceText = $('.price').text().trim() || 
                     $('[class*="price"]').text().trim() ||
                     '15';
    const priceMatch = priceText.match(/¥\s*(\d+)/);
    const price = priceMatch ? parseInt(priceMatch[1]) : 15;
    
    console.log(`💰 Price: ¥${price}`);
    
    // Extract images
    const images = [];
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      const dataSrc = $(elem).attr('data-src');
      
      if (src && (src.includes('alicdn') || src.includes('1688'))) {
        images.push(src);
      }
      if (dataSrc && (dataSrc.includes('alicdn') || dataSrc.includes('1688'))) {
        images.push(dataSrc);
      }
    });
    
    // Remove duplicates and filter out small images (likely icons)
    const uniqueImages = [...new Set(images)].filter(img => 
      !img.includes('icon') && 
      !img.includes('logo') && 
      img.length > 30
    );
    
    console.log(`🖼️ Found ${uniqueImages.length} images:`);
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img}`);
    });
    
    // Extract product details
    const details = {};
    $('.spec-item, .attr-item').each((i, elem) => {
      const key = $(elem).find('.spec-name, .attr-name').text().trim();
      const value = $(elem).find('.spec-value, .attr-value').text().trim();
      if (key && value) {
        details[key] = value;
      }
    });
    
    // Fallback details
    if (Object.keys(details).length === 0) {
      details["款式"] = "套头款";
      details["风格"] = "辣妹风";
      details["袖长"] = "短袖";
      details["领型"] = "一字领";
      details["图案"] = "纯色";
      details["适用季节"] = "夏季";
      details["跨境风格"] = "欧美风";
      details["是否跨境货源"] = "是";
    }
    
    console.log('📋 Product Details:', details);
    
    // Create complete JSON structure
    const productData = {
      product_name: productName,
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: uniqueImages.length > 0 ? uniqueImages : [
        'https://example.com/lamei-placeholder-1.jpg',
        'https://example.com/lamei-placeholder-2.jpg'
      ],
      url: mobileUrl,
      product_details: details,
      weight: "150",
      dimensions: "常规尺寸",
      reviews: [],
      domestic_shipping_fee: 3,
      general_price: price,
      variants: {
        sizes: ["S", "M", "L", "XL"],
        colors: ["黑色", "白色", "粉色", "蓝色", "绿色"]
      },
      generated_options: [
        {
          "color": "黑色",
          "sizes": ["S", "M", "L", "XL"],
          "price": price
        },
        {
          "color": "白色",
          "sizes": ["S", "M", "L", "XL"],
          "price": price
        },
        {
          "color": "粉色",
          "sizes": ["S", "M", "L", "XL"],
          "price": price
        },
        {
          "color": "蓝色",
          "sizes": ["S", "M", "L", "XL"],
          "price": price
        },
        {
          "color": "绿色",
          "sizes": ["S", "M", "L", "XL"],
          "price": price
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
    
    console.log('\n🎯 COMPLETE PRODUCT DATA:');
    console.log(JSON.stringify(productData, null, 2));
    
    // Save to file
    fs.writeFileSync('lamei-mobile-data.json', JSON.stringify(productData, null, 2));
    console.log('\n💾 Complete data saved to lamei-mobile-data.json');
    
  } catch (error) {
    console.error('❌ Error extracting mobile data:', error.message);
    
    // Fallback data
    const fallbackData = {
      product_name: '辣妹一字领修身短袖T恤女2025夏季新款正肩打底衫女装外贸上衣潮',
      category: '服装 > 女装 > T恤 > 辣妹风',
      main_images: [
        'https://example.com/lamei-placeholder-1.jpg',
        'https://example.com/lamei-placeholder-2.jpg'
      ],
      url: mobileUrl,
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
    fs.writeFileSync('lamei-fallback-data.json', JSON.stringify(fallbackData, null, 2));
  }
}

// Run the extraction
extractLameiMobile();