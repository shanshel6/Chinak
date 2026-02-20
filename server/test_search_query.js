
import axios from 'axios';

const API_URL = 'http://localhost:5001/api';

async function testSearch() {
  try {
    console.log('Testing search endpoint...');
    const response = await axios.get(`${API_URL}/products/search`, {
      params: { q: 'iphone' } // Simple query
    });
    
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));
    
    if (response.data && Array.isArray(response.data.products)) {
      console.log(`Found ${response.data.products.length} products`);
      if (response.data.products.length > 0) {
        console.log('First product:', response.data.products[0].name);
      }
    }
  } catch (error) {
    console.error('Search failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testSearch();
