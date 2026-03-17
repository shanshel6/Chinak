import { embedImage } from './services/clipService.js';
import axios from 'axios';
import fs from 'fs';

async function testBase64() {
  console.log('1. Downloading a test image...');
  // Download a tiny image just to convert to base64
  const res = await axios.get('https://img.alicdn.com/bao/uploaded/i4/O1CN0127KYFK1x7sjOFyRa9_!!4611686018427381805-0-fleamarket.jpg', { responseType: 'arraybuffer' });
  const buffer = Buffer.from(res.data);
  const base64Str = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  
  console.log(`2. Image downloaded and converted to base64. Length: ${base64Str.length}`);
  
  console.log('3. Passing base64 string to embedImage (simulating the frontend upload behavior)...');
  try {
      // The API endpoint strips the prefix and passes a Buffer
      const match = base64Str.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      const data = match[2];
      const testBuffer = Buffer.from(data, 'base64');
      
      const embedding = await embedImage(testBuffer);
      console.log(`✅ Success! Embedding length: ${embedding.length}`);
      console.log(`First 5 values: ${embedding.slice(0, 5)}`);
  } catch (err) {
      console.error(`❌ FAILED:`, err);
  }
}

testBase64();