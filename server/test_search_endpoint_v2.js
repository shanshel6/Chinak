
import axios from 'axios';

const API_URL = 'http://127.0.0.1:5001/api';

async function testSearchEndpoint() {
  try {
    console.log('Testing search endpoint: GET /api/products?search=phone');
    const response = await axios.get(`${API_URL}/products`, {
      params: { search: 'phone' }
    });
    
    console.log('Status:', response.status);
    console.log('Engine:', response.data.engine);
    console.log('Total:', response.data.total);
    console.log('Products found:', response.data.products?.length);
    
    if (response.data.engine === 'meili') {
      console.log('SUCCESS: Meilisearch is being used!');
    } else {
      console.log('WARNING: Fallback engine used:', response.data.engine);
    }
    
  } catch (error) {
    console.error('Search request failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testSearchEndpoint();
