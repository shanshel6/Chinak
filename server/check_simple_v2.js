
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
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.products) {
        json.products.forEach(p => {
          console.log(`ID: ${p.id}, Name: ${p.name.substring(0, 15)}...`);
          console.log(`  NewOrOld: ${p.neworold}`);
          console.log(`  AI Metadata:`, p.aiMetadata ? JSON.stringify(p.aiMetadata).substring(0, 100) + '...' : 'null');
        });
      }
    } catch (e) { console.error(e); }
  });
});
req.end();
