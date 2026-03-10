import axios from 'axios';
import fs from 'fs';

async function testApi() {
  try {
    console.log('Fetching http://localhost:5001/api/products...');
    const response = await axios.get('http://localhost:5001/api/products');
    console.log('Success:', response.status);
    fs.writeFileSync('server/api_success.json', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('Error:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
      fs.writeFileSync('server/api_error.json', JSON.stringify(error.response.data, null, 2));
    } else {
      fs.writeFileSync('server/api_network_error.txt', error.message);
    }
  }
}

testApi();
