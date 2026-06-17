import sys
import traceback

print("Debugging AraCLIP model loading...")

# First, let's check what's in the araclip module
try:
    import araclip
    print("✅ Imported araclip")
    
    # List all attributes
    print("\n--- araclip module attributes ---")
    for attr in dir(araclip):
        if not attr.startswith('_'):
            print(f"  {attr}")
    
    # Check the AraClip class
    print("\n--- AraClip class ---")
    if hasattr(araclip, 'AraClip'):
        print("  AraClip class found")
        # Check its methods
        araclip_class = araclip.AraClip
        print("  Methods:")
        for method in dir(araclip_class):
            if not method.startswith('_'):
                print(f"    {method}")
    else:
        print("  ❌ AraClip class not found!")
        
except Exception as e:
    print(f"❌ Failed to import araclip: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50 + "\n")

# Try to load the model with different approaches
print("Testing different model loading approaches...")

# Approach 1: Direct transformers loading
print("\n--- Approach 1: Direct transformers loading ---")
try:
    from transformers import AutoModel, AutoTokenizer, AutoImageProcessor
    print("✅ Imported transformers")
    
    # Try to load the model directly
    model_name = "Arabic-Clip/araclip"
    print(f"Loading model: {model_name}")
    
    # Check what's in the model config
    from transformers import AutoConfig
    config = AutoConfig.from_pretrained(model_name)
    print(f"Model config:")
    print(f"  Model type: {config.model_type}")
    print(f"  Architectures: {config.architectures}")
    print(f"  Hidden size: {config.hidden_size}")
    
    # Try to load the model
    model = AutoModel.from_pretrained(model_name)
    print(f"✅ Model loaded directly via transformers")
    print(f"  Model class: {type(model)}")
    
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50 + "\n")

# Approach 2: Check if we can use the model with CLIP architecture
print("--- Approach 2: Checking CLIP compatibility ---")
try:
    from transformers import CLIPModel, CLIPProcessor
    print("✅ Imported CLIP components")
    
    # Try to load as CLIP
    model_name = "Arabic-Clip/araclip"
    print(f"Trying to load as CLIP model: {model_name}")
    
    try:
        clip_model = CLIPModel.from_pretrained(model_name)
        print(f"✅ Loaded as CLIP model")
    except Exception as e:
        print(f"❌ Cannot load as CLIP model: {str(e)}")
        
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50 + "\n")

# Approach 3: Check the actual model files
print("--- Approach 3: Checking model files ---")
try:
    import huggingface_hub
    print("✅ Imported huggingface_hub")
    
    model_name = "Arabic-Clip/araclip"
    print(f"Listing files for: {model_name}")
    
    from huggingface_hub import list_repo_files
    files = list(list_repo_files(model_name))
    print(f"Files in repository:")
    for file in files[:20]:  # Show first 20 files
        print(f"  {file}")
    
    # Check for config file
    config_files = [f for f in files if 'config' in f.lower()]
    print(f"\nConfig files: {config_files}")
    
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()