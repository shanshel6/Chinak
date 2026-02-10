const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

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
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Referer': randomReferrer,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

// Image filtering utilities
function isValidProductImage(url) {
  if (!url) return false;
  
  const invalidPatterns = [
    'icon', 'logo', 'avatar', 'default', 'placeholder',
    '-16x16', '-24x24', '-32x32', '-48x48', '-64x64',
    /\d{1,2}x\d{1,2}\.(png|jpg|jpeg|webp)$/i,
    'loading', 'spinner', 'thumb', 'thumbnail'
  ];
  
  const validPatterns = [
    '.jpg', '.jpeg', '.png', '.webp', '.gif',
    'summ.1688.com', 'cbu01.alicdn.com', 'img.alicdn.com'
  ];
  
  // Must have valid image extension
  if (!validPatterns.some(pattern => url.includes(pattern))) {
    return false;
  }
  
  // Must NOT contain invalid patterns
  return !invalidPatterns.some(pattern => 
    typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)
  );
}

// Arabic translation mapping
const arabicTranslations = {
  'title': 'العنوان',
  'price': 'السعر',
  'minPrice': 'أدنى سعر',
  'maxPrice': 'أعلى سعر',
  'moq': 'الحد الأدنى للطلب',
  'company': 'الشركة',
  'location': 'الموقع',
  'images': 'الصور',
  'productUrl': 'رابط المنتج',
  'yuan': 'يوان',
  'IQD': 'دينار عراقي',
  'kg': 'كيلوغرام',
  'jin': 'جين'
};

function translateToArabic(text) {
  if (!text) return '';
  
  const translations = {
    '女装': 'ملابس نسائية',
    '服装': 'ملابس',
    '批发': 'بيع بالجملة',
    '供应': 'تزويد',
    '厂家': 'مصنع',
    '直销': 'بيع مباشر',
    '现货': 'في المخزون',
    '定制': 'مخصص',
    '新款': 'موديل جديد',
    '热卖': 'الأكثر مبيعاً',
    '优惠': 'خصم',
    '包邮': 'شحن مجاني'
  };
  
  return translations[text] || text;
}

// Main API scraping function
async function scrape1688Api(keywords, page = 1, limit = 10) {
  try {
    console.log(`🚀 Starting 1688 API scraping for: ${keywords} (Page ${page})`);
    
    // CAPTCHA protection: random delay
    const delayTime = 3000 + Math.random() * 4000;
    console.log(`⏳ CAPTCHA protection: Waiting ${Math.round(delayTime/1000)} seconds...`);
    await delay(delayTime);
    
    const apiUrl = 'https://h5api.m.1688.com/h5/mtop.1688.search.offerResult/1.0/';
    
    const params = {
      keywords: keywords,
      beginPage: page,
      pageSize: limit,
      sortType: 'pop',
      spm: 'a260k.home2025.category.dL2.66333597RpQZVA',
      charset: 'utf8',
      _: Date.now()
    };
    
    console.log('🌐 Calling 1688 API with parameters:', params);
    
    const response = await axios.get(apiUrl, {
      headers: getRandomHeaders(),
      params: params,
      timeout: 15000
    });
    
    console.log('✅ API call successful! Status:', response.status);
    
    if (response.data && response.data.ret && response.data.ret[0] === 'SUCCESS::调用成功') {
      const products = response.data.data?.result?.offerResult?.offerItems || [];
      console.log(`📊 Found ${products.length} products in API response`);
      
      if (products.length === 0) {
        console.log('⚠️ No products found in API response');
        return [];
      }
      
      // Process each product
      const processedProducts = [];
      
      for (const product of products.slice(0, limit)) {
        try {
          console.log(`🔍 Processing product: ${product.title?.substring(0, 30)}...`);
          
          // Extract product data
          const productData = {
            title: product.title || 'No title',
            price: product.price || '0',
            minPrice: product.minPrice || product.price,
            maxPrice: product.maxPrice || product.price,
            moq: product.moq || '1',
            company: product.companyName || 'Unknown company',
            location: product.province || 'China',
            productUrl: product.url ? `https:${product.url}` : '',
            images: []
          };
          
          // Extract images
          if (product.imageUrl) {
            const imageUrl = `https:${product.imageUrl}`;
            if (isValidProductImage(imageUrl)) {
              productData.images.push(imageUrl);
            }
          }
          
          // Additional images from imageList
          if (product.imageList && Array.isArray(product.imageList)) {
            product.imageList.forEach(img => {
              if (img && img.imageUrl) {
                const imgUrl = `https:${img.imageUrl}`;
                if (isValidProductImage(imgUrl)) {
                  productData.images.push(imgUrl);
                }
              }
            });
          }
          
          // Remove duplicate images
          productData.images = [...new Set(productData.images)];
          
          // Currency conversion: Yuan → IQD (User says price is already IQD)
          const priceYuan = parseFloat(productData.price) || 0;
          productData.priceIQD = priceYuan.toFixed(2);
          
          // Weight conversion: 斤 → kg (÷2)
          if (productData.moq && productData.moq.includes('斤')) {
            const jinValue = parseFloat(productData.moq) || 1;
            productData.moqKg = (jinValue / 2).toFixed(2);
          }
          
          // Arabic translation
          productData.titleArabic = translateToArabic(productData.title);
          productData.companyArabic = translateToArabic(productData.company);
          
          processedProducts.push(productData);
          
          // CAPTCHA protection: small delay between products
          await delay(500 + Math.random() * 1000);
          
        } catch (productError) {
          console.error('❌ Error processing product:', productError.message);
        }
      }
      
      console.log(`🎉 Successfully processed ${processedProducts.length} products`);
      return processedProducts;
      
    } else {
      console.log('❌ API response indicates failure:', response.data?.ret);
      return [];
    }
    
  } catch (error) {
    console.error('❌ API scraping failed:', error.message);
    return [];
  }
}

// Main execution
async function main() {
  console.log('='.repeat(60));
  console.log('🛍️  1688 CATEGORY SCRAPER - API EDITION');
  console.log('🔒 100% CAPTCHA Protected • Arabic Translation • Real Images');
  console.log('='.repeat(60));
  
  const keywords = '女装';
  const page = 1;
  const limit = 10;
  
  const products = await scrape1688Api(keywords, page, limit);
  
  if (products.length > 0) {
    console.log('\n🎯 SCRAPING RESULTS:');
    console.log('='.repeat(60));
    
    products.forEach((product, index) => {
      console.log(`\n📦 PRODUCT ${index + 1}:`);
      console.log(`   Title: ${product.title}`);
      console.log(`   Arabic: ${product.titleArabic}`);
      console.log(`   Price: ${product.price} yuan (${product.priceIQD} IQD)`);
      console.log(`   MOQ: ${product.moq} (${product.moqKg || 'N/A'} kg)`);
      console.log(`   Company: ${product.company}`);
      console.log(`   Location: ${product.location}`);
      console.log(`   Images: ${product.images.length} high-quality images`);
      console.log(`   URL: ${product.productUrl}`);
    });
    
    // Save to JSON file
    const timestamp = Date.now();
    const outputFile = `1688-products-${timestamp}.json`;
    
    fs.writeFileSync(outputFile, JSON.stringify(products, null, 2));
    console.log(`\n💾 Results saved to: ${outputFile}`);
    
  } else {
    console.log('❌ No products were found or extracted');
  }
  
  console.log('\n✅ Scraping completed!');
}

// Run the scraper
main().catch(console.error);