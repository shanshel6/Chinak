
import http from 'http';

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/products?limit=5',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.products) {
        console.log(`Found ${json.products.length} products`);
        json.products.forEach(p => {
          console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 15)}..., NewOrOld: ${p.neworold} (${typeof p.neworold})`);
        });
      } else {
        console.log('No products found in response');
      }
    } catch (e) {
      console.error('Error parsing JSON:', e.message);
      console.log('Raw data:', data.substring(0, 200));
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
