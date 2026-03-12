
import axios from 'axios';

async function checkApi() {
  console.log('Starting checkApi...');
  try {
    // 1. Check Search API
    console.log('--- Checking Search API (http://localhost:5001/api/search?q=phone&limit=5) ---');
    const searchRes = await axios.get('http://localhost:5001/api/search?q=phone&limit=5', { timeout: 5000 });
    console.log('Search API Status:', searchRes.status);
    if (searchRes.data && searchRes.data.products) {
      console.log(`Found ${searchRes.data.products.length} products in search.`);
      searchRes.data.products.forEach(p => {
        console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 20)}..., NewOrOld: ${p.neworold} (${typeof p.neworold})`);
      });
    } else {
      console.log('No products in search response');
    }

    // 2. Check Home/Products API
    console.log('\n--- Checking Products API (http://localhost:5001/api/products?limit=5) ---');
    const productsRes = await axios.get('http://localhost:5001/api/products?limit=5', { timeout: 5000 });
    console.log('Products API Status:', productsRes.status);
    if (productsRes.data && productsRes.data.products) {
      console.log(`Found ${productsRes.data.products.length} products in home list.`);
      productsRes.data.products.forEach(p => {
        console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 20)}..., NewOrOld: ${p.neworold} (${typeof p.neworold})`);
      });
    } else {
      console.log('No products in products response');
    }

  } catch (error) {
    console.error('API Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
        console.error('Connection refused. Is the server running on port 5001?');
    }
    if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', error.response.data);
    }
  }
  console.log('Finished checkApi.');
}

checkApi();
