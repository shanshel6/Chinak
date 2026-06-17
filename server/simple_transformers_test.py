import sys
print("Testing transformers import...")
sys.stdout.flush()

try:
    import transformers
    print(f"✅ Transformers version: {transformers.__version__}")
    sys.stdout.flush()
    
    # Check if we can list models
    from transformers import CLIPModel
    print("✅ CLIPModel imported")
    sys.stdout.flush()
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    sys.stdout.flush()
    import traceback
    traceback.print_exc()

print("Test complete")
sys.stdout.flush()