
import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, 'server/.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';
const PORT = process.env.PORT || 5001;

const token = jwt.sign(
  { id: 1, role: 'ADMIN', email: 'admin@test.com', name: 'Admin' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const productData = {
  "products": [ 
     { 
       "product_id": "567402067238", 
       "product_name": "ركنة حديد (زاوية) ستانلس ثخينة - لتقوية الكنتورات والأثاث", 
       "category": "إكسسوارات أثاث - براغي وزوايا", 
       "main_images": [ 
         "https://cbu01.alicdn.com/img/ibank/O1CN01G6A66u1HpeIPjvnXK_!!2639750807-0-cib.jpg"
       ], 
       "url": "http://detail.m.1688.com/page/index.html?offerId=567402067238", 
       "product_details": { 
         "المادة / المكونات": "فولاذ مقاوم للصدأ"
       }, 
       "weight": "0.12", 
       "dimensions": "10*10*5", 
       "general_price": 26, 
       "domestic_shipping": 700, 
       "generated_options": [ 
         { 
           "color": "فضي ستانلس", 
           "sizes": ["20*20*16 ملم"], 
           "price": 26 
         }, 
         { 
           "color": "فضي ستانلس", 
           "sizes": ["25*25*16 ملم"], 
           "price": 40 
         }
       ]
     } 
   ] 
};

async function test() {
  try {
    console.log('Importing product...');
    const res = await axios.post(`http://localhost:${PORT}/api/admin/products/bulk-import`, productData, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Import Result:', JSON.stringify(res.data, null, 2));

    // Wait a bit for processing if async (but bulk-import seems sync for the first part)
    // Actually bulk-import returns job status? 
    // Wait, the code I read had: app.post('/api/admin/products/bulk-import', ... runs await runBulkProductsImport ... res.json(results))
    // So it waits.

    console.log('Fetching product...');
    const searchRes = await axios.get(`http://localhost:${PORT}/api/products?search=ركنة حديد`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const products = searchRes.data.products;
    if (products.length === 0) {
      console.log('Product not found!');
      return;
    }

    const p = products[0];
    console.log('Product Found:', p.name);
    console.log('Main Price:', p.price);
    console.log('Sea Price:', p.seaPrice);
    console.log('Air Price:', p.airPrice);
    console.log('Variants:', p.variants.length);
    p.variants.forEach(v => {
      console.log(`Variant: Price=${v.price}, Sea=${v.seaPrice}, Air=${v.airPrice}, BaseRMB=${v.basePriceRMB}`);
    });

  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
}

test();
