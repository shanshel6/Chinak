import { RawImage } from '@xenova/transformers';

async function test() {
  const urls = [
    "https://img.alicdn.com/bao/uploaded/i2/O1CN01wxAW431OHUUdXlXTJ_!!4611686018427382448-53-fleamarket.heic_450x10000Q90.jpg_.webp",
    "https://img.alicdn.com/bao/uploaded/i2/O1CN01wGupXP1HWsT6Db0T0_!!4611686018427387054-0-fleamarket.jpg"
  ];
  for (const url of urls) {
    try {
      console.log("Fetching", url);
      const img = await RawImage.fromURL(url);
      console.log("Success! size:", img.width, img.height);
    } catch (err) {
      console.error("Failed to load:", err.message);
    }
  }
}
test();