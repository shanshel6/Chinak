
import sys
import os

print("Testing AraCLIP model loading...")

# Try 1: Using araclip package
print("\n--- Test 1: Using araclip.AraClip.from_pretrained()")
try:
    from araclip import AraClip
    print("  Imported AraClip successfully!")
    
    try:
        model = AraClip.from_pretrained()
        print("  SUCCESS! Model loaded!")
        print(f"  Model info:", model)
    except Exception as e:
        print(f"  FAILED:", str(e))

except Exception as e:
    print("  FAILED to import araclip:", str(e))

# Try 2: Using transformers directly
print("\n--- Test 2: Using transformers directly")
try:
    from transformers import AutoModel, AutoProcessor
    print("  transformers imported!")
    try:
        processor = AutoProcessor.from_pretrained("Arabic-Clip/araclip")
        model = AutoModel.from_pretrained("Arabic-Clip/araclip")
        print("  SUCCESS! Loaded directly with transformers!")
    except Exception as e:
        print("  FAILED:", str(e))
        import traceback
        print(traceback.format_exc())
except Exception as e:
    print("  transformers import failed:", str(e))

print("\n--- Done!")
