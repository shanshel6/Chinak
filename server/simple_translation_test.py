import sys
print("Python version:", sys.version)
print("Python executable:", sys.executable)

try:
    import googletrans
    print("✅ googletrans module found")
    print("googletrans version:", googletrans.__version__)
    
    # Try to import Translator
    from googletrans import Translator
    print("✅ Translator imported successfully")
    
    # Simple test
    translator = Translator()
    result = translator.translate("مرحبا", src='ar', dest='en')
    print(f"Translation test: 'مرحبا' → '{result.text}'")
    print("✅ Translation works!")
    
except ImportError as e:
    print("❌ Import error:", str(e))
    print("\nTrying to list installed packages...")
    import subprocess
    try:
        result = subprocess.run([sys.executable, "-m", "pip", "list"], capture_output=True, text=True)
        print("Installed packages:")
        print(result.stdout[:1000])  # First 1000 chars
    except:
        print("Could not list packages")
        
except Exception as e:
    print("❌ Error:", str(e))
    import traceback
    traceback.print_exc()