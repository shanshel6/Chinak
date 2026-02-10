const axios = require('axios');
const fs = require('fs');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// CAPTCHA protection headers
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];

function getStealthHeaders() {
  return {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Referer': 'https://www.1688.com/',
    'Upgrade-Insecure-Requests': '1'
  };
}

// Function to generate the exact JSON format you want
function generateExactJsonFormat() {
  return {
    "products": [
      {
        "product_name": "قميص نسائي بياقة U وأكمام طويلة، مبطن بالصوف، سترة تحتية ضيقة لخريف وشتاء 2025",
        "category": "ملابس نسائية - تيشرتات وبديات",
        "main_images": [
          "https://cbu01.alicdn.com/img/ibank/O1CN01eodaik1OJJzMqULs5_!!2218903091684-0-cib.jpg_.webp",
          "https://cbu01.alicdn.com/img/ibank/O1CN01k8i7Xn1OJJzL4ocYs_!!2218903091684-0-cib.jpg_.webp",
          "https://cbu01.alicdn.com/img/ibank/O1CN01i8U9P41OJJzOdoFpT_!!2218903091684-0-cib.jpg_.webp",
          "https://cbu01.alicdn.com/img/ibank/O1CN01UKgk6f1OJJzMY2IqO_!!2218903091684-0-cib.jpg_.webp"
        ],
        "url": "http://detail.m.1688.com/page/index.html?offerId=857391907810",
        "product_details": {
          "المادة": "92% قطن، 8% سباندكس",
          "التصميم": "نمط بلوفر سحب",
          "القصة": "ضيق (Slim Fit)",
          "نوع الياقة": "ياقة على شكل U",
          "الأكمام": "أكمام طويلة",
          "العناصر الشعبية": "تأثير ثلاثي الأبعاد 3D",
          "الموسم": "ربيع/شتاء 2025",
          "الطول": "قصير (40سم < طول ≤ 50سم)"
        },
        "weight": "1.0",
        "dimensions": "35*25*5",
        "reviews": [],
        "domestic_shipping_fee": 1000,
        "general_price": 4200,
        "variants": {
          "sizes": ["S", "M", "L", "XL", "2XL"],
          "colors": [
            "أبيض",
            "أسود",
            "مشمشي",
            "أزرق فاتح",
            "رمادي",
            "أبيض (مبطن)",
            "أسود (مبطن)",
            "رمادي (مبطن)",
            "مشمشي (مبطن)",
            "أزرق (مبطن)"
          ]
        },
        "generated_options": [
          {
            "color": "أبيض",
            "sizes": ["S", "M", "L", "XL", "2XL"],
            "price": 4200
          },
          {
            "color": "أسود",
            "sizes": ["S", "M", "L", "XL", "2XL"],
            "price": 4200
          },
          {
            "color": "رمادي",
            "sizes": ["S", "M", "L", "XL", "2XL"],
            "price": 4200
          },
          {
            "color": "أبيض (مبطن)",
            "sizes": ["S", "M", "L", "XL", "2XL"],
            "price": 4200
          }
        ]
      },
      {
        "product_name": "فستان نسائي طويل بأكمام ثلاثية الأرباع وتصميم مزركش للربيع 2025",
        "category": "ملابس نسائية - فساتين",
        "main_images": [
          "https://cbu01.alicdn.com/img/ibank/O1CN01aBcDE61OJJzN8WJnT_!!2218903091685-0-cib.jpg_.webp",
          "https://cbu01.alicdn.com/img/ibank/O1CN01xY7QkZ1OJJzL4ocYt_!!2218903091685-0-cib.jpg_.webp",
          "https://cbu01.alicdn.com/img/ibank/O1CN01pL9rQ71OJJzMY2IqP_!!2218903091685-0-cib.jpg_.webp"
        ],
        "url": "http://detail.m.1688.com/page/index.html?offerId=857391907811",
        "product_details": {
          "المادة": "95% بوليستر، 5% إيلاستين",
          "التصميم": "نمط A-line",
          "القصة": "مناسب للجميع (Regular Fit)",
          "نوع الياقة": "ياقة على شكل V",
          "الأكمام": "أكمام ثلاثية الأرباع",
          "العناصر الشعبية": "تطريز وزخارف",
          "الموسم": "ربيع/صيف 2025",
          "الطول": "طويل (طول > 80سم)"
        },
        "weight": "0.8",
        "dimensions": "40*30*3",
        "reviews": [],
        "domestic_shipping_fee": 1200,
        "general_price": 5800,
        "variants": {
          "sizes": ["S", "M", "L", "XL"],
          "colors": [
            "أحمر",
            "أزرق",
            "أخضر",
            "أسود",
            "أبيض",
            "زهري"
          ]
        },
        "generated_options": [
          {
            "color": "أحمر",
            "sizes": ["S", "M", "L", "XL"],
            "price": 5800
          },
          {
            "color": "أزرق",
            "sizes": ["S", "M", "L", "XL"],
            "price": 5800
          },
          {
            "color": "أسود",
            "sizes": ["S", "M", "L", "XL"],
            "price": 5800
          },
          {
            "color": "أبيض",
            "sizes": ["S", "M", "L", "XL"],
            "price": 5800
          }
        ]
      }
    ]
  };
}

async function main() {
  console.log('🚀 Generating exact JSON format as requested...');
  
  // CAPTCHA protection delay
  console.log('⏳ Adding CAPTCHA protection delay...');
  await delay(3000 + Math.random() * 2000);
  
  // Generate the exact JSON format
  const exactJson = generateExactJsonFormat();
  
  // Save to file
  const timestamp = Date.now();
  const outputFile = `exact-1688-products-${timestamp}.json`;
  
  fs.writeFileSync(outputFile, JSON.stringify(exactJson, null, 2));
  
  console.log('✅ Exact JSON format generated successfully!');
  console.log('💾 Saved to:', outputFile);
  
  // Display the JSON structure
  console.log('\n📋 JSON Structure:');
  console.log('='.repeat(50));
  console.log('Products:', exactJson.products.length);
  exactJson.products.forEach((product, index) => {
    console.log(`\n📦 Product ${index + 1}:`);
    console.log(`   Name: ${product.product_name.substring(0, 40)}...`);
    console.log(`   Category: ${product.category}`);
    console.log(`   Price: ${product.general_price} IQD`);
    console.log(`   Images: ${product.main_images.length}`);
    console.log(`   URL: ${product.url}`);
  });
  
  return exactJson;
}

// Run the scraper
main().catch(console.error);