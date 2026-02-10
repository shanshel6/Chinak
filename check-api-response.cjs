
async function checkProduct() {
  try {
    const response = await fetch('http://localhost:5001/api/products/7466');
    if (!response.ok) {
      console.log('Error fetching product:', response.status, response.statusText);
      try {
        const text = await response.text();
        console.log('Response body:', text);
      } catch (e) {}
      return;
    }
    const product = await response.json();
    console.log('Product Base Price RMB:', product.basePriceRMB);
    
    if (product.variants && product.variants.length > 0) {
      console.log('Variants found:', product.variants.length);
      product.variants.forEach((v, i) => {
        console.log(`Variant ${i}: ID=${v.id}, Price=${v.price}, BasePriceRMB=${v.basePriceRMB}, Combination=${v.combination}`);
      });
    } else {
      console.log('No variants found.');
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

checkProduct();
