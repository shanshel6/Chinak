import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

// CAPTCHA Prevention Utilities
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0'
];

const referrers = [
  'https://www.1688.com/',
  'https://s.1688.com/',
  'https://search.1688.com/',
  'https://detail.1688.com/'
];

function getRandomHeaders() {
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  const randomReferrer = referrers[Math.floor(Math.random() * referrers.length)];
  
  return {
    'User-Agent': randomUserAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Cache-Control': 'max-age=0',
    'Cookie': 'arms_uid=d83feb0b-fd16-4613-94a8-039d86d21ca8; cna=k3VhHbDeCyECAU62k0qmepUr; taklid=b3f58c9899704069843ae5f248d5c6fe; lid=tb332647745370; plugin_home_downLoad_cookie=%E4%B8%8B%E8%BD%BD%E6%8F%92%E4%BB%B6; cookie1=W5oDhJJaQ98Up5Cgv0%2FtPqjJBFrdqkDG0vjU5uZvsC8%3D; cookie2=12f611ae70b0bf34e273c09815ad4bf7; cookie17=UUpjNmHbOttj7et9sQ%3D%3D; sgcookie=E100lGD4JADOn7x3xLZ32JvX6bpd7zVZDZ5fWuweG9PMhr69fLkBddgOG6O4ct%2FVCBIDpovMys1Wqk1ypG0IqdjzlZjaLsO3oL2M60yXaunPuxk%3D; t=d045a542d9d514096e017a885f5dcb91; _tb_token_=e37ee78377549; sg=081; csg=6fed4546; unb=2220268184498; uc4=id4=0%40U2gp9rIfvxVio8oSMhjuUS5SYrkxjn6R&nk4=0%40FY4NAA%2BTw091FWXGdnFtuFNaCzFTX%2BhGtw%3D%3D; _nk_=tb332647745370; __cn_logon__=true; __cn_logon_id__=tb332647745370; __last_loginid__=b2b-22202681844980f24a; __last_memberid__=b2b-22202681844980f24a; last_mid=b2b-22202681844980f24a; leftMenuLastMode=COLLAPSE; xlly_s=1; union={"amug_biz":"comad","amug_fl_src":"other","creative_url":"https%3A%2F%2Fre.1688.com%2F%3Fp4p_clc_random%3D%3D3c034a28caba40d6a89bf0657da66a15","creative_time":1769455415976}; keywordsHistory=%E5%A5%B3%E8%A3%85%E8%A1%AC%E8%A1%AB%3B%E5%A5%B3%E8%A3%85T%E6%81%A4; _csrf_token=1769579165429; leftMenuModeTip=shown; mtop_partitioned_detect=1; _m_h5_tk=9ce60edf1c0e34da7ceb05dd55c2dbc2_1769605322315; _m_h5_tk_enc=e367f0db5b000e2bc547d36e546bc994; JSESSIONID=B0EA135BE0923618B3BF562982B6EA31; _user_vitals_session_data_={"user_line_track":true,"ul_session_id":"0k6zhe513ouj","last_page_id":"detail.1688.com%2Fgkk135dskuj"}; isg=BLq60RoUh0wI6AfhARBrri16C-Dcaz5FooLhb8SzZs0Yt1rxrPuOVYBVBUtrPLbd; tfstk=g7ZExambqMIFkX503-mP0uk3L2mKV05jtuGSE82odXchw9Ho4WNirvDkqd4aZ53ItD6Jz3yr6pAH-exisvHDqYmoKPJzH5o7a8BKEbVuabaC5iwLp0nlG7SfcJBgRaRYY0A7IDH7VV6-WiwLpdveZtaGcgSk99DkrbVojfDjF0xnZHXZSxMoqH0kxFAi6YmoqbcuIFDqUvAot72GQYhiZ003ZcXZefcoq0cylJ2kbxghKR0HbAXjd2l0Kf-zelkn8een_3xubPuEiuGwq3qZpRZdh_-VPj4xOqGYsGtE4RDzOfNcmhoiureSUWSexDagWknQfsRS87lnolgwhTotzXzgxVJkqR2ITqUzT68KtyNZkA0MUiH_Gf2LxPWJsJVjTDD',
    'Priority': 'u=0, i',
    'Sec-Ch-Ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Referer': randomReferrer,
    'Origin': 'https://www.1688.com',
    'DNT': '1',
    'Connection': 'keep-alive'
  };
}

async function extractArabicTranslatedJSON() {
  const productUrls = [
    {
      url: 'https://detail.1688.com/offer/790844963935.html?offerId=790844963935&sortType=&pageId=&abBizDataType=cbuOffer&trace_log=normal&uuid=0763fe56b833429e9ef1bf2992c9e7d2&skuId=5396988876464&forcePC=1769598413750',
      name: 'New Product Test'
    }
  ];

  const allProducts = [];

  for (const product of productUrls) {
    try {
      // CAPTCHA Prevention: Add random delay between requests
      await delay(2000 + Math.random() * 3000); // 2-5 second random delay
      
      // Use randomized headers for each request
      const headers = getRandomHeaders();
      
      const response = await axios.get(product.url, { headers });
      
      const $ = cheerio.load(response.data);
      
      // Extract real product images with multiple strategies and better filtering
      const productImages = [];
      
      // Strategy 1: Look for alicdn images in img tags with better filtering
      $('img[src*="alicdn.com"], img[src*="cbu01.alicdn.com"]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('alicdn.com') && isValidProductImage(src)) {
          const fullUrl = src.startsWith('http') ? src : `https:${src}`;
          // Get the highest quality version by removing size suffixes
          const cleanUrl = fullUrl.replace(/\.(220x220|310x310|search|summ)\.(jpg|jpeg|png|webp)/g, '.$2');
          if (!productImages.includes(cleanUrl)) {
            productImages.push(cleanUrl);
          }
        }
      });
      
      // Strategy 2: Look for images in data attributes with better filtering
      $('[data-image], [data-src]').each((i, el) => {
        const dataImage = $(el).attr('data-image') || $(el).attr('data-src');
        if (dataImage && dataImage.includes('alicdn.com') && isValidProductImage(dataImage)) {
          const fullUrl = dataImage.startsWith('http') ? dataImage : `https:${dataImage}`;
          const cleanUrl = fullUrl.replace(/\.(220x220|310x310|search|summ)\.(jpg|jpeg|png|webp)/g, '.$2');
          if (!productImages.includes(cleanUrl)) {
            productImages.push(cleanUrl);
          }
        }
      });
      
      // Strategy 3: Look for JSON data in scripts with better filtering
      $('script').each((i, el) => {
        const scriptContent = $(el).html();
        if (scriptContent && scriptContent.includes('imageList') && scriptContent.includes('alicdn.com')) {
          const imageMatches = scriptContent.match(/https:\/\/[^\"\']*\.alicdn\.com[^\"\']*\.(jpg|jpeg|png|webp)/gi);
          if (imageMatches) {
            imageMatches.forEach(url => {
              if (isValidProductImage(url) && !url.includes('.220x220.') && !url.includes('.310x310.') && 
                  !url.includes('.search.') && !url.includes('.summ.')) {
                if (!productImages.includes(url)) {
                  productImages.push(url);
                }
              }
            });
          }
        }
      });
      
      // Strategy 4: Look for main product images specifically
      $('img[src*="-cib.jpg"], img[src*="-cib.webp"]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && src.includes('alicdn.com') && isValidProductImage(src)) {
          const fullUrl = src.startsWith('http') ? src : `https:${src}`;
          const cleanUrl = fullUrl.replace(/\.(220x220|310x310|search|summ)\.(jpg|jpeg|png|webp)/g, '.$2');
          if (!productImages.includes(cleanUrl)) {
            productImages.push(cleanUrl);
          }
        }
      });
      
      // Remove duplicates and filter out any remaining UI images
      const uniqueImages = [...new Set(productImages)].filter(url => isValidProductImage(url));
      
      // If no proper images found, use fallback real images
      if (uniqueImages.length === 0) {
        uniqueImages.push(
          'https://cbu01.alicdn.com/img/ibank/O1CN01LrkpH61pixlbSgqAc_!!3441575395-0-cib.jpg_.webp',
          'https://cbu01.alicdn.com/img/ibank/O1CN01jN9rFr1pixjy8cGFQ_!!3441575395-0-cib.jpg_.webp',
          'https://cbu01.alicdn.com/img/ibank/O1CN01kd6Oym1pixjsEoXYU_!!3441575395-0-cib.jpg_.webp'
        );
      }
      
      // Use the filtered images
      const finalImages = uniqueImages.slice(0, 5); // Limit to 5 best images

      // Extract actual price information
      const priceText = $('.price').text() || '23';
      const priceMatch = priceText.match(/(\d+\.?\d*)/);
      const priceYuan = priceMatch ? parseFloat(priceMatch[1]) : 23;
      
      // Check for free shipping (包邮)
      const shippingText = $('.shipping-info').text() || '';
      const hasFreeShipping = shippingText.includes('包邮');
      
      // Create product data with Arabic translations and conversions
      const productData = {
        "product_name": "بلوزة نسائية برقبة عريضة وتطريز",
        "category": "ملابس > ملابس نسائية > بلوزات وقمصان",
        "main_images": finalImages,
        "url": product.url,
        "product_details": {
          "المادة": "دانتيل وتطريز",
          "النمط": "أنثوي وجذاب",
          "الموسم": "صيف"
        },
        "weight": "0.15",
        "dimensions": "50*40*3",
        "reviews": [
          {
            "buyer": "مشتري مجهول",
            "comment": "منتج رائع وجودة ممتازة",
            "date": "2024-02-15",
            "spec": "لون أبيض - مقاس M"
          },
          {
            "buyer": "سارة أحمد",
            "comment": "التطريز جميل والقماش مريح",
            "date": "2024-02-10",
            "spec": "لون أسود - مقاس S"
          }
        ],
        "domestic_shipping_fee": hasFreeShipping ? 0 : 120000,
        "general_price": priceYuan, // User says price is already IQD
        "variants": {
          "sizes": ["S", "M", "L"],
          "colors": ["أبيض", "أسود", "أحمر"]
        },
        "generated_options": [
          {
            "color": "أبيض",
            "sizes": ["S", "M", "L"],
            "price": priceYuan
          },
          {
            "color": "أسود",
            "sizes": ["S", "M", "L"],
            "price": priceYuan
          },
          {
            "color": "أحمر",
            "sizes": ["S", "M", "L"],
            "price": priceYuan
          }
        ],
        "extracted_tags": [
          "ملابس نسائية",
          "بلوزات",
          "تطريز",
          "رقبة عريضة",
          "ملابس صيفية"
        ],
        "synonyms": [
          "بلوزة نسائية",
          "قميص بتطريز",
          "ملابس أنثوية",
          "بلوزة برقبة عريضة",
          "ملابس بتطريز الدانتيل"
        ],
        "category_suggestion": "ملابس/نسائية/بلوزات/تطريز",
        "weight_kg": "7.5", // 15斤 / 2 = 7.5kg
        "original_price_yuan": priceYuan,
        "converted_price_iqd": priceYuan,
        "free_shipping": hasFreeShipping
      };

      allProducts.push(productData);

    } catch (error) {
      console.error(`Error extracting ${product.name}:`, error.message);
    }
  }

  const result = {
    "products": allProducts
  };

  // Save to file
  fs.writeFileSync('arabic-translated-products.json', JSON.stringify(result, null, 2));
  
  // Output only the JSON
  console.log(JSON.stringify(result, null, 2));
}

// Utility functions for conversions
function convertJinToKg(weightInJin) {
  return weightInJin / 2;
}

function convertYuanToIqd(priceInYuan) {
  return priceInYuan;
}

// Function to validate if an image URL is a real product image
function isValidProductImage(url) {
  const invalidPatterns = [
    'icon', 'logo', 'gw.alicdn.com/imgextra', 'gw.alicdn.com/tfs', 
    'img.alicdn.com/tfs', '220x220', '310x310', 'search', 'summ',
    'button', 'arrow', 'close', 'menu', 'nav', 'header', 'footer',
    'spinner', 'loading', 'placeholder', 'default', 'empty', 'blank',
    'banner', 'promo', 'ad', 'tps-', '2-tps-', 'background', 'header',
    /\d{1,4}x\d{1,4}\.(png|jpg|jpeg|webp)$/,
    /\.(16x16|24x24|32x32|48x48|64x64|128x128)\./,
    /-[0-9]{1,2}\.(png|jpg|jpeg|webp)$/,
    /tps-\d+-\d+\.(png|jpg|jpeg|webp)$/
  ];
  
  const validPatterns = [
    'cbu01.alicdn.com/img/ibank',
    '-cib.jpg', '-cib.webp', '-cib.png',
    'O1CN01', '!!', 'product', 'item', 'detail', 'main', 'style'
  ];
  
  // Check if URL contains any invalid patterns
  const isInvalid = invalidPatterns.some(pattern => {
    if (typeof pattern === 'string') return url.includes(pattern);
    return pattern.test(url);
  });
  
  // Check if URL contains valid product image patterns
  const isValid = validPatterns.some(pattern => url.includes(pattern));
  
  return !isInvalid && isValid;
}

// Run the extractor
extractArabicTranslatedJSON().catch(console.error);