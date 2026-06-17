#!/usr/bin/env python3
import sys
import os
import json
import traceback

print("=== AraCLIP Debug Script ===")
print(f"Python version: {sys.version}")
print(f"Current directory: {os.getcwd()}")

# Try different import methods
print("\n--- Testing imports ---")

# Method 1: Try araclip package
print("\n1. Testing araclip.AraClip.from_pretrained()")
try:
    from araclip import AraClip
    print("  ✅ Imported araclip successfully")
    
    # Try loading model
    print("  Trying to load model...")
    try:
        model = AraClip.from_pretrained()
        print("  ✅ Model loaded with AraClip.from_pretrained()")
        print(f"  Model type: {type(model)}")
    except Exception as e:
        print(f"  ❌ Failed to load with AraClip.from_pretrained(): {str(e)}")
        
    # Try loading with explicit name
    print("  Trying to load with 'Arabic-Clip/araclip'...")
    try:
        model = AraClip.from_pretrained("Arabic-Clip/araclip")
        print("  ✅ Model loaded with explicit name")
        print(f"  Model type: {type(model)}")
    except Exception as e:
        print(f"  ❌ Failed to load with explicit name: {str(e)}")
        
except Exception as e:
    print(f"  ❌ Failed to import araclip: {str(e)}")

# Method 2: Try transformers directly
print("\n2. Testing transformers directly")
try:
    import transformers
    print(f"  ✅ Imported transformers version: {transformers.__version__}")
    
    # Try AutoModel
    print("  Trying AutoModel.from_pretrained('Arabic-Clip/araclip')...")
    try:
        from transformers import AutoModel
        model = AutoModel.from_pretrained("Arabic-Clip/araclip")
        print("  ✅ AutoModel loaded successfully")
        print(f"  Model type: {type(model)}")
        print(f"  Model config: {model.config}")
    except Exception as e:
        print(f"  ❌ AutoModel failed: {str(e)}")
        
    # Try CLIPModel
    print("  Trying CLIPModel.from_pretrained('Arabic-Clip/araclip')...")
    try:
        from transformers import CLIPModel
        model = CLIPModel.from_pretrained("Arabic-Clip/araclip")
        print("  ✅ CLIPModel loaded successfully")
        print(f"  Model type: {type(model)}")
        print(f"  Model config: {model.config}")
    except Exception as e:
        print(f"  ❌ CLIPModel failed: {str(e)}")
        
except Exception as e:
    print(f"  ❌ Failed to import transformers: {str(e)}")

# Method 3: Check what's actually in the model
print("\n3. Checking model files")
try:
    from huggingface_hub import snapshot_download
    import tempfile
    
    print("  Downloading model snapshot...")
    cache_dir = tempfile.mkdtemp()
    model_path = snapshot_download(
        repo_id="Arabic-Clip/araclip",
        cache_dir=cache_dir
    )
    print(f"  ✅ Model downloaded to: {model_path}")
    
    # List files
    print("  Model files:")
    for root, dirs, files in os.walk(model_path):
        for file in files:
            if file.endswith(('.json', '.txt', '.py', '.md')):
                filepath = os.path.join(root, file)
                rel_path = os.path.relpath(filepath, model_path)
                print(f"    {rel_path}")
                
except Exception as e:
    print(f"  ❌ Failed to check model files: {str(e)}")

print("\n=== Debug Complete ===")