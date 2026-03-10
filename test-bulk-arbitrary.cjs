
const fetch = require('node-fetch');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE_URL = 'http://localhost:5001';
const JWT_SECRET = "c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=";

async function run() {
  const token = jwt.sign(
    { 
      id: 71, 
      email: 'admin@example.com', 
      role: 'ADMIN', 
      permissions: ['manage_products'] 
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const productData = {
    title: "Chair Test Sea Shipping",
    price: 58 * 200, // Just a placeholder for main price
    basePriceRMB: 58,
    length: 65,
    width: 62,
    height: 32,
    weight: 15, // Arbitrary weight > 1kg
    generated_options: [
            {
              combination: {
                "color": "Beige",
                "sizes": "Fixed Base"
              },
              price: 58, // 58 * 200 = 11600 IQD Base
              stock: 100,
              image: ""
            }
          ]
  };

  try {
    console.log('Sending bulk create request...');
    const res = await fetch(`${BASE_URL}/api/admin/products/bulk-create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ products: [productData] })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Error:', text);
      return;
    }

    const data = await res.json();
    console.log('Bulk create success:', data.success);

    if (data.products && data.products.length > 0) {
      const pid = data.products[0].id;
      console.log(`Product created with ID: ${pid}`);

      const detailsRes = await fetch(`${BASE_URL}/api/products/${pid}`);
      const details = await detailsRes.json();

      console.log('--- Verification ---');
      console.log('Product BasePriceRMB:', details.basePriceRMB);
      
      details.variants.forEach((v, i) => {
        console.log(`Variant ${i}:`);
        console.log(`  Combination: ${JSON.stringify(v.combination)}`);
        console.log(`  Price: ${v.price}`);
        console.log(`  BasePriceRMB: ${v.basePriceRMB}`);
      });
      
      console.log('Options created:', JSON.stringify(details.options, null, 2));
    }

  } catch (err) {
    console.error(err);
  }
}

run();
