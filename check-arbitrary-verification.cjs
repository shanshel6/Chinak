
const fetch = require('node-fetch');
async function run() {
  const pid = 7467;
  console.log(`Checking product ${pid}...`);
  try {
    const res = await fetch(`http://localhost:5001/api/products/${pid}`);
    if (!res.ok) {
        console.log('Error fetching:', res.status);
        return;
    }
    const details = await res.json();
    console.log('Product BasePriceRMB:', details.basePriceRMB);
    if (details.variants) {
        details.variants.forEach((v, i) => {
            console.log(`Variant ${i}: Price=${v.price}, BasePriceRMB=${v.basePriceRMB}, Combination=${JSON.stringify(v.combination)}`);
        });
    }
    console.log('Options:', JSON.stringify(details.options, null, 2));
  } catch (e) {
      console.error(e);
  }
}
run();
