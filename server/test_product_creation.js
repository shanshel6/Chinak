import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000/api';

async function testProductCreation() {
  const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  
  const productData = {
    name: 'Test Product ' + Date.now(),
    chineseName: '测试产品',
    price: 100,
    image: base64Image,
    images: [base64Image, base64Image],
    status: 'PUBLISHED',
    isActive: true,
    description: 'This is a test product with a base64 image.'
  };

  try {
    console.log('Creating product...');
    const response = await fetch(`${BASE_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(productData)
    });

    const result = await response.json();
    if (response.ok) {
      console.log('Product created successfully:', result.id);
      console.log('Main image URL in DB:', result.image.substring(0, 50) + '...');
    } else {
      console.error('Failed to create product:', result);
    }
  } catch (error) {
    console.error('Error during test:', error);
  }
}

testProductCreation();
