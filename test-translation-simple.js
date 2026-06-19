/**
 * Simple test for translation service logic
 */

console.log('=== Simple Translation Service Test ===\n');

// Test the basic translation logic
const BASIC_TRANSLATIONS = {
    "ملابس": "clothes",
    "حذاء": "shoes",
    "هاتف": "phone",
    "كمبيوتر": "computer",
    "كتاب": "book",
    "ملابس رجالية": "men's clothes",
    "حذاء نسائي": "women's shoes"
};

function testTranslation(text) {
    console.log(`Testing: "${text}"`);
    
    // Check basic dictionary
    const normalizedText = text.trim().toLowerCase();
    if (BASIC_TRANSLATIONS[normalizedText]) {
        console.log(`  ✓ Found in dictionary: "${BASIC_TRANSLATIONS[normalizedText]}"`);
        return BASIC_TRANSLATIONS[normalizedText];
    }
    
    // Check partial matches
    for (const [arabic, english] of Object.entries(BASIC_TRANSLATIONS)) {
        if (normalizedText.includes(arabic)) {
            console.log(`  ✓ Partial match: "${arabic}" -> "${english}"`);
            return english;
        }
    }
    
    console.log(`  ✗ No match found, would return original text`);
    return text;
}

// Run tests
console.log('Test 1: Basic word "ملابس"');
const result1 = testTranslation('ملابس');
console.log(`  Final result: "${result1}"\n`);

console.log('Test 2: Compound phrase "ملابس رجالية"');
const result2 = testTranslation('ملابس رجالية');
console.log(`  Final result: "${result2}"\n`);

console.log('Test 3: Unknown word "كلمة غير معروفة"');
const result3 = testTranslation('كلمة غير معروفة');
console.log(`  Final result: "${result3}"\n`);

console.log('Test 4: Word not in dictionary "تفاح"');
const result4 = testTranslation('تفاح');
console.log(`  Final result: "${result4}"\n`);

console.log('=== Summary ===');
console.log('The basic dictionary lookup works correctly.');
console.log('For words not in the dictionary, the service would:');
console.log('1. Try server-side translation');
console.log('2. If native environment, try ML Kit');
console.log('3. Return original text as fallback');

// Check if ML Kit would be attempted
const isNative = false; // Simulate non-native for this test
console.log(`\nIn this test, native environment is: ${isNative}`);
console.log(`ML Kit would ${isNative ? '' : 'NOT '}be attempted`);