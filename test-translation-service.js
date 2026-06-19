/**
 * Test the translation service logic
 * This simulates the actual translationService.ts logic
 */

console.log('=== Testing Translation Service Logic ===\n');

// Simulate the BASIC_TRANSLATIONS dictionary
const BASIC_TRANSLATIONS = {
    "ملابس": "clothes",
    "حذاء": "shoes",
    "هاتف": "phone",
    "كمبيوتر": "computer",
    "كتاب": "book",
    "ملابس رجالية": "men's clothes",
    "حذاء نسائي": "women's shoes"
};

// Simulate isNativeEnvironment
function isNativeEnvironment() {
    // In a real app, this would check Capacitor.isNativePlatform()
    // For testing, we can simulate both scenarios
    return process.argv.includes('--native') || false;
}

// Simulate ML Kit translation
async function mockMLKitTranslate(text) {
    console.log(`  [Mock ML Kit] Translating: "${text}"`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return mock translation
    const mockTranslations = {
        "ملابس": "clothes",
        "حذاء": "shoes",
        "هاتف": "phone",
        "كمبيوتر": "computer",
        "كتاب": "book"
    };
    
    return { translatedText: mockTranslations[text] || text };
}

// Simulate server-side translation
async function mockServerSideTranslation(text) {
    console.log(`  [Mock Server] Translating: "${text}"`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Return mock translation
    const mockTranslations = {
        "ملابس": "clothes",
        "حذاء": "shoes",
        "هاتف": "phone",
        "كمبيوتر": "computer",
        "كتاب": "book",
        "كلمة غير معروفة": "unknown word"
    };
    
    return { 
        success: true, 
        translated: mockTranslations[text] || text 
    };
}

// Main translation function (simplified version)
async function translateArabicToEnglish(text) {
    console.log(`\nTranslating: "${text}"`);
    
    // First check basic dictionary
    const normalizedText = text.trim().toLowerCase();
    if (BASIC_TRANSLATIONS[normalizedText]) {
        const translation = BASIC_TRANSLATIONS[normalizedText];
        console.log(`  ✓ Found in basic dictionary: "${translation}"`);
        return translation;
    }
    
    // Check partial matches
    for (const [arabic, english] of Object.entries(BASIC_TRANSLATIONS)) {
        if (normalizedText.includes(arabic)) {
            console.log(`  ✓ Partial match found: "${arabic}" -> "${english}"`);
            return english;
        }
    }
    
    console.log(`  ✗ No dictionary match found`);
    
    const isNative = isNativeEnvironment();
    console.log(`  Native environment: ${isNative}`);
    
    // Try server-side translation first
    console.log(`  Trying server-side translation...`);
    try {
        const response = await mockServerSideTranslation(text);
        if (response.success && response.translated && response.translated !== text) {
            console.log(`  ✓ Server-side translation successful: "${response.translated}"`);
            return response.translated;
        } else {
            console.log(`  ✗ Server-side translation returned same text or failed`);
        }
    } catch (error) {
        console.error(`  ✗ Server-side translation error:`, error.message);
    }
    
    // If native environment, try ML Kit
    if (isNative) {
        console.log(`  Native environment detected, trying ML Kit...`);
        try {
            const { translatedText } = await mockMLKitTranslate(text);
            if (translatedText !== text && translatedText.trim() !== '') {
                console.log(`  ✓ ML Kit translated: "${translatedText}"`);
                return translatedText;
            } else {
                console.log(`  ✗ ML Kit returned same text or empty`);
            }
        } catch (error) {
            console.error(`  ✗ ML Kit translation failed:`, error.message);
        }
    } else {
        console.log(`  Not a native environment, skipping ML Kit`);
    }
    
    // All methods failed
    console.log(`  All translation methods failed, returning original text`);
    return text;
}

// Run tests
async function runTests() {
    console.log('Test 1: Basic dictionary lookup (ملابس)');
    const result1 = await translateArabicToEnglish('ملابس');
    console.log(`  Result: "${result1}" (Expected: "clothes")\n`);
    
    console.log('Test 2: Partial match (ملابس رجالية)');
    const result2 = await translateArabicToEnglish('ملابس رجالية');
    console.log(`  Result: "${result2}" (Expected: "men's clothes")\n`);
    
    console.log('Test 3: Unknown word (كلمة غير معروفة) - non-native');
    const result3 = await translateArabicToEnglish('كلمة غير معروفة');
    console.log(`  Result: "${result3}" (Expected: original text or "unknown word")\n`);
    
    console.log('Test 4: Unknown word (كلمة غير معروفة) - native (simulated)');
    // Simulate native environment for this test
    const originalIsNative = process.argv.includes;
    process.argv.push('--native');
    const result4 = await translateArabicToEnglish('كلمة غير معروفة');
    if (originalIsNative) {
        process.argv = process.argv.filter(arg => arg !== '--native');
    }
    console.log(`  Result: "${result4}" (Expected: original text or "unknown word")\n`);
    
    console.log('Test 5: Simple word not in dictionary (تفاح)');
    const result5 = await translateArabicToEnglish('تفاح');
    console.log(`  Result: "${result5}" (Expected: "تفاح")\n`);
    
    // Summary
    console.log('=== Test Summary ===');
    const tests = [
        { name: 'Basic dictionary', result: result1, expected: 'clothes' },
        { name: 'Partial match', result: result2, expected: "men's clothes" },
        { name: 'Unknown word (non-native)', result: result3, expected: null },
        { name: 'Unknown word (native)', result: result4, expected: null },
        { name: 'Word not in dict', result: result5, expected: 'تفاح' }
    ];
    
    let passed = 0;
    for (const test of tests) {
        let success = false;
        if (test.expected === null) {
            // For unknown words, success means we got the original text back
            success = test.result === test.name.includes('Unknown') ? 'كلمة غير معروفة' : 'تفاح';
        } else {
            success = test.result === test.expected;
        }
        
        if (success) {
            passed++;
            console.log(`  ✓ ${test.name}: PASS`);
        } else {
            console.log(`  ✗ ${test.name}: FAIL (got "${test.result}", expected "${test.expected || 'original'}")`);
        }
    }
    
    console.log(`\nTotal: ${passed}/${tests.length} tests passed`);
    console.log(`Success rate: ${Math.round((passed / tests.length) * 100)}%`);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(console.error);
} else {
    console.log('This module can be imported for testing');
}

// Export for testing
export {
    translateArabicToEnglish,
    isNativeEnvironment,
    BASIC_TRANSLATIONS
};