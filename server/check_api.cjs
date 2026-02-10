
const axios = require('axios');

console.log('Script started');

async function checkApi() {
  try {
    const response = await axios.get('http://localhost:5001/api/products?limit=5');
    console.log('Status:', response.status);
    
    const products = response.data.products;
    if (products && products.length > 0) {
      products.forEach(p => {
        console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 20)}..., Price: ${p.price}, BaseRMB: ${p.basePriceRMB}, Combined: ${p.isPriceCombined}`);
      });
    } else {
      console.log('No products found');
    }

    // Check specific product 7530 if not in list
    // Or search for it
    const searchRes = await axios.get('http://localhost:5001/api/products?search=نيرمانة&limit=1');
    const p7530 = searchRes.data.products[0];
    if (p7530) {
        console.log('--- Product 7530 ---');
        console.log(`ID: ${p7530.id}, Price: ${p7530.price}, BaseRMB: ${p7530.basePriceRMB}, Combined: ${p7530.isPriceCombined}`);
    } else {
        console.log('Product 7530 not found via search');
    }

  } catch (error) {
    console.error('Error fetching API:', error.message);
  }
}

checkApi();
