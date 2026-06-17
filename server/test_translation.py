import sys
import traceback

print("Testing Arabic to English translation...")

try:
    # Try to import googletrans
    from googletrans import Translator
    
    print("✅ googletrans imported successfully")
    
    # Test translation
    translator = Translator()
    
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
            translation = translator.translate(arabic_text, src='ar', dest='en')
            print(f"  '{arabic_text}' → '{translation.text}'")
        except Exception as e:
            print(f"  '{arabic_text}' → ERROR: {str(e)}")
    
    print("\n✅ Translation test completed")
    
except ImportError:
    print("❌ googletrans not installed")
    print("Install with: pip install googletrans==4.0.0-rc1")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    traceback.print_exc()