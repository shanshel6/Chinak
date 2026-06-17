import sys
print("Starting test...")
sys.stdout.flush()

try:
    from araclip import AraClip
    print("✅ AraClip imported")
    sys.stdout.flush()
    
    print("Trying to load model...")
    sys.stdout.flush()
    
    model = AraClip.from_pretrained("Arabic-Clip/araclip")
    print("✅ Model loaded")
    sys.stdout.flush()
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    sys.stdout.flush()
    import traceback
    traceback.print_exc()
    
print("Test complete")
sys.stdout.flush()