import sys
print("Testing Arabic to English translation with 'translate' library...")

try:
    from translate import Translator
    
    print("✅ Translator imported successfully")
    
    # Create translator from Arabic to English
    translator = Translator(to_lang="en", from_lang="ar")
    
    # Test cases
    test_cases = [
        "قندرة رياضية سوداء",  # black sports shoes
        "هاتف ذكي",  # smartphone
        "كمبيوتر محمول",  # laptop
        "تلفزيون",  # television
        "سيارة",  # car
    ]
    
    print("\nTranslation test results:")
    for arabic_text in test_cases:
        try:
            translation = translator.translate(arabic_text)
            print(f"  '{arabic_text}' → '{translation}'")
        except Exception as e:
            print(f"  '{arabic_text}' → ERROR: {str(e)}")
    
    print("\n✅ Translation test completed")
    
except ImportError as e:
    print(f"❌ Import error: {str(e)}")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    import traceback
    traceback.print_exc()