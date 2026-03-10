
const BASE_URL = 'http://localhost:5001';

async function run() {
  console.log('Fetching products list...');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${BASE_URL}/api/products?limit=1`, { signal: controller.signal });
    clearTimeout(timeout);
    
    console.log(`Status: ${res.status}`);
    if (!res.ok) {
        const text = await res.text();
        console.log('Error text:', text);
    } else {
        const data = await res.json();
        console.log('Fetched ' + (data.products ? data.products.length : 0) + ' products');
        if (data.products && data.products.length > 0) {
            console.log('First product ID:', data.products[0].id);
        }
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run();
