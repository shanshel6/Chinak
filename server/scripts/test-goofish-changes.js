// Test script to verify the changes to goofish-category-scraper.js

// Test the extractGoofishCategoryId function
function extractGoofishCategoryId(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return String(parsed.searchParams.get('categoryId') || '').trim();
  } catch {
    return '';
  }
}

// Test the parseSpecsFromConditionText function
function parseSpecsFromConditionText(conditionText) {
  if (!conditionText) return [];
  // Split by spaces and filter out empty strings
  const specs = conditionText.split(/\s+/).filter(spec => spec.trim().length > 0);
  return specs;
}

// Test cases
console.log('Testing extractGoofishCategoryId function:');
const testUrl1 = 'https://www.goofish.com/item?spm=a21ybx.search.searchFeedList.2.307823551iqwzH&id=991252654865&categoryId=126902001';
const testUrl2 = 'https://www.goofish.com/item?id=123456&categoryId=789012';
const testUrl3 = 'https://www.goofish.com/item?id=123456';
const testUrl4 = 'invalid-url';

console.log(`URL: ${testUrl1}`);
console.log(`Extracted categoryId: "${extractGoofishCategoryId(testUrl1)}"`);
console.log(`Expected: "126902001"`);
console.log(`Pass: ${extractGoofishCategoryId(testUrl1) === '126902001'}`);

console.log(`\nURL: ${testUrl2}`);
console.log(`Extracted categoryId: "${extractGoofishCategoryId(testUrl2)}"`);
console.log(`Expected: "789012"`);
console.log(`Pass: ${extractGoofishCategoryId(testUrl2) === '789012'}`);

console.log(`\nURL: ${testUrl3}`);
console.log(`Extracted categoryId: "${extractGoofishCategoryId(testUrl3)}"`);
console.log(`Expected: ""`);
console.log(`Pass: ${extractGoofishCategoryId(testUrl3) === ''}`);

console.log(`\nURL: ${testUrl4}`);
console.log(`Extracted categoryId: "${extractGoofishCategoryId(testUrl4)}"`);
console.log(`Expected: ""`);
console.log(`Pass: ${extractGoofishCategoryId(testUrl4) === ''}`);

console.log('\n\nTesting parseSpecsFromConditionText function:');
const testCondition1 = '轻微穿着痕迹 36 包头凉鞋';
const testCondition2 = '全新 黑色 M码';
const testCondition3 = '';
const testCondition4 = '单一规格';

console.log(`Condition: "${testCondition1}"`);
console.log(`Parsed specs: ${JSON.stringify(parseSpecsFromConditionText(testCondition1))}`);
console.log(`Expected: ["轻微穿着痕迹", "36", "包头凉鞋"]`);
console.log(`Pass: ${JSON.stringify(parseSpecsFromConditionText(testCondition1)) === JSON.stringify(["轻微穿着痕迹", "36", "包头凉鞋"])}`);

console.log(`\nCondition: "${testCondition2}"`);
console.log(`Parsed specs: ${JSON.stringify(parseSpecsFromConditionText(testCondition2))}`);
console.log(`Expected: ["全新", "黑色", "M码"]`);
console.log(`Pass: ${JSON.stringify(parseSpecsFromConditionText(testCondition2)) === JSON.stringify(["全新", "黑色", "M码"])}`);

console.log(`\nCondition: "${testCondition3}"`);
console.log(`Parsed specs: ${JSON.stringify(parseSpecsFromConditionText(testCondition3))}`);
console.log(`Expected: []`);
console.log(`Pass: ${JSON.stringify(parseSpecsFromConditionText(testCondition3)) === JSON.stringify([])}`);

console.log(`\nCondition: "${testCondition4}"`);
console.log(`Parsed specs: ${JSON.stringify(parseSpecsFromConditionText(testCondition4))}`);
console.log(`Expected: ["单一规格"]`);
console.log(`Pass: ${JSON.stringify(parseSpecsFromConditionText(testCondition4)) === JSON.stringify(["单一规格"])}`);

console.log('\n\nTesting itemData structure:');
const mockItemData = {
  title: '透明包头高跟鞋 闲置清 跟高4厘米:36码(微磨损，介意勿拍) 因清仓处理售出不退不换，看好再下单。',
  titleEn: 'حذاء بكعب شفاف رأس مغلق مستعمل ارتفاع 4 سم مقاس 36 (باهت قليلاً، إذا كنت حساساً لا تشتري) بسبب التصفية لا استرجاع ولا استبدال، تأكد قبل الشراء.',
  descriptionAr: 'حذاء بكعب شفاف رأس مغلق مستعمل ارتفاع 4 سم مقاس 36 (باهت قليلاً، إذا كنت حساساً لا تشتري) بسبب التصفية لا استرجاع ولا استبدال، تأكد قبل الشراء.',
  keywords: ['حذاء', 'بكعب', 'شفاف', 'مستعمل', 'مقاس 36', 'تخفيض', 'تخليص'],
  newOrOld: false,
  realBrand: false,
  priceCny: 29,
  image: 'https://img.alicdn.com/bao/uploaded/i1/3459074994/O1CN01iz9aa11mlJ3T4HueT_!!4611686018427382706-0-xy_item.jpg_450x10000Q90.jpg_.webp',
  url: testUrl1,
  goofishCategoryId: extractGoofishCategoryId(testUrl1),
  specs: parseSpecsFromConditionText(testCondition1)
};

console.log('Mock itemData structure:');
console.log(JSON.stringify(mockItemData, null, 2));

console.log('\nVerifying fields:');
console.log(`- Has goofishCategoryId: ${mockItemData.goofishCategoryId ? 'YES' : 'NO'} (value: "${mockItemData.goofishCategoryId}")`);
console.log(`- Has specs: ${mockItemData.specs && mockItemData.specs.length > 0 ? 'YES' : 'NO'} (value: ${JSON.stringify(mockItemData.specs)})`);
console.log(`- Specs count: ${mockItemData.specs.length}`);

console.log('\n\nAll tests completed!');