
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const BASE_URL = 'http://localhost:5001';
// Use the secret from .env or the one found in test-bulk-arbitrary.cjs
const JWT_SECRET = "c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY="; 

async function run() {
  const token = jwt.sign(
    { 
      id: 71, 
      email: 'admin@example.com', 
      role: 'ADMIN', 
      permissions: ['manage_products', 'manage_orders', 'view_reports', 'manage_users', 'manage_settings'] 
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const products = [ 
   { 
     "product_id": "1770794923-2", 
     "product_name": "مجموعة العناية بالبشرة الاحترافية [SANRINADER] - عبوات صالونات كبيرة", 
     "category": "تجميل / عناية بالوجه", 
     "isAirRestricted": true, 
     "main_images": [ 
       "https://cbu01.alicdn.com/img/ibank/O1CN01fcv02T22KlxDd8mIM_!!2215935327102-0-cib.jpg_.webp", 
       "https://cbu01.alicdn.com/img/ibank/O1CN011pi4Sz22KlxJg0HGQ_!!2215935327102-0-cib.jpg_.webp", 
       "https://cbu01.alicdn.com/img/ibank/O1CN013M9esd22KlxIvCptY_!!2215935327102-0-cib.jpg_.webp", 
       "https://cbu01.alicdn.com/img/ibank/O1CN01dygZG622KlxHwSRf6_!!2215935327102-0-cib.jpg_.webp", 
       "https://cbu01.alicdn.com/img/ibank/O1CN01J85bn122KlxIvCIel_!!2215935327102-0-cib.jpg_.webp" 
     ], 
     "url": "http://detail.m.1688.com/page/index.html?offerId=984219191844", 
     "product_details": { 
       "الماركة": "SANRINADER / 仙蕾娜德", 
       "المكونات": "خلاصات نباتية, حمض الهيالورونيك, لؤلؤ طبيعي", 
       "الميزة": "ترطيب عميق, تفتيح البشرة, تنظيف مسام, مخصص للاستخدام المهني في مراكز التجميل", 
       "الاستخدام": "تنظيف الوجه, جلسات التقشير, ماسكات النضارة" 
     }, 
     "general_price": 9800, 
     "domestic_shipping": 1200, 
     "delivery_time": 1, 
     "generated_options": [ 
       { 
         "color": "تونر منقي بالخلاصات النباتية 500 مل", 
         "sizes": ["حجم صالونات"], 
         "price": 9800 
       }, 
       { 
         "color": "جل تقشير الهيالورونيك 500 مل", 
         "sizes": ["حجم صالونات"], 
         "price": 9800 
       }, 
       { 
         "color": "لوشن ترطيب حريري 500 مل", 
         "sizes": ["حجم صالونات"], 
         "price": 11800 
       }, 
       { 
         "color": "باودر ماسك الذهب للإشراق", 
         "sizes": ["قياس قياسي"], 
         "price": 8000 
       }, 
       { 
         "color": "باودر ماسك بتلات الورد الكريستالي", 
         "sizes": ["قياس قياسي"], 
         "price": 8000 
       } 
     ], 
     "aimetatags": { 
       "synonyms": ["مواد تجميل صالونات", "تونر كبير", "ماسك باودر", "عدة تنظيف بشرة"], 
       "extracted_tags": ["SANRINADER", "حجم كبير", "عناية احترافية", "ترطيب"], 
       "category_suggestion": "معدات ومواد صالونات التجميل" 
     } 
   }
 ];

  console.log('Sending bulk import request...');
  try {
    const res = await fetch(`${BASE_URL}/api/admin/products/bulk-import-jobs`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ products })
    });

    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text);
  } catch (err) {
    console.error('Request failed:', err);
  }
}

run();
