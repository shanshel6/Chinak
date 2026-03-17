import { embedImage } from './services/clipService.js';

async function test() {
  const url = "https://img.alicdn.com/bao/uploaded/i2/O1CN01wxAW431OHUUdXlXTJ_!!4611686018427382448-53-fleamarket.heic_450x10000Q90.jpg_.webp";
  console.log("Starting test...");
  try {
    const emb = await embedImage(url);
    console.log("Success! length:", emb.length);
    console.log("Is it zeroes?", emb.every(v => v === 0));
    console.log("First 5 values:", emb.slice(0, 5));
  } catch (err) {
    console.error("Failed to load:", err.stack);
  }
}
test().then(() => console.log("Done")).catch(console.error);
