
const BASE_URL = 'http://localhost:5001';

async function run() {
  console.log('Fetching product 7461...');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const res = await fetch(`${BASE_URL}/api/products/7461`, { signal: controller.signal });
    clearTimeout(timeout);
    
    console.log(`Status: ${res.status}`);
    if (!res.ok) {
        const text = await res.text();
        console.log('Error text:', text);
    } else {
        const data = await res.json();
        console.log('Product fetched successfully');
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run();
