
const fetch = require('node-fetch');
const jwt = require('./server/node_modules/jsonwebtoken');

const BASE_URL = 'http://localhost:5001';
const JWT_SECRET = "c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY="; // From .env

async function run() {
  // 1. Generate Admin Token
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

  const productData = {
    title: "Test Dynamic Variant Product 2",
    price: 100,
    basePriceRMB: 50,
    variants: [
      {
        combination: {
          "Model": "Pro Max",
          "Material": "Titanium",
          "Capacity": "1TB"
        },
        price: 150,
        basePriceRMB: 75,
        stock: 10,
        weight: 0.5,
        shippingMethod: "air"
      },
      {
        combination: {
          "Model": "Pro",
          "Material": "Aluminum",
          "Capacity": "512GB"
        },
        price: 120,
        basePriceRMB: 60,
        stock: 5,
        weight: 0.5,
        shippingMethod: "sea"
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

    if (!data.products || data.products.length === 0) {
      console.error('No products returned in bulk create response');
      return;
    }

    const product = data.products[0];
    console.log(`Product created with ID: ${product.id}`);

    // Verify variants
    const detailsRes = await fetch(`${BASE_URL}/api/products/${product.id}`);
    const details = await detailsRes.json();

    console.log('Product Options:', JSON.stringify(details.options, null, 2));
    console.log('Product Variants:', JSON.stringify(details.variants.map(v => ({
      combo: v.combination,
      basePriceRMB: v.basePriceRMB,
      price: v.price
    })), null, 2));

  } catch (err) {
    console.error(err);
  }
}

run();
