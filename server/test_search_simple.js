
import http from 'http';

const options = {
  hostname: '127.0.0.1',
  port: 5001,
  path: '/api/products?search=phone',
  method: 'GET',
  headers: {
    'Accept': 'application/json'
  }
};

console.log('Starting request...');

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response received.');
    try {
      const json = JSON.parse(data);
      console.log('Engine:', json.engine);
      console.log('Products found:', json.products?.length);
      console.log('Total:', json.total);
    } catch (e) {
      console.error('Failed to parse JSON:', e.message);
      console.log('Raw body:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => {
  console.error(`Request error: ${e.message}`);
});

req.end();
