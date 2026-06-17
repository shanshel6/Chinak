import sys
import traceback
import numpy as np
from PIL import Image

print("Testing fixed AraCLIP model loading...")

# Approach: Load the model directly using the correct architecture
print("\n--- Approach 1: Load BERT model directly ---")
try:
    from transformers import AutoModel, AutoTokenizer, AutoImageProcessor
    import torch
    
    model_name = "Arabic-Clip/araclip"
    
    # First, let's check what's actually in the model
    print(f"Loading model: {model_name}")
    
    # Try to load the model with trust_remote_code=True
    model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
    print(f"✅ Model loaded with trust_remote_code=True")
    print(f"  Model class: {type(model)}")
    
    # Check if it has the embed method
    if hasattr(model, 'embed'):
        print(f"  Has embed method: Yes")
    else:
        print(f"  Has embed method: No")
        
    # Try to embed something
    print("\n--- Testing embedding ---")
    
    # Create a simple test image
    test_image = Image.new('RGB', (224, 224), color='red')
    
    try:
        # Try the embed method if it exists
        if hasattr(model, 'embed'):
            embedding = model.embed(image=test_image)
            print(f"✅ Image embedding generated via embed()")
            print(f"  Shape: {embedding.shape}")
            print(f"  Type: {type(embedding)}")
            print(f"  First 5 values: {embedding[:5]}")
        else:
            print("❌ Model doesn't have embed() method")
            
    except Exception as e:
        print(f"❌ Embedding failed: {str(e)}")
        traceback.print_exc()
        
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50 + "\n")

# Approach 2: Try to understand the model structure better
print("--- Approach 2: Examining model structure ---")
try:
    # Let's look at the actual model files
    import requests
    import json
    
    # Get the config again
    url = 'https://huggingface.co/Arabic-Clip/araclip/raw/main/config.json'
    response = requests.get(url)
    config = response.json()
    
    print("Model config analysis:")
    print(f"  Model type: {config.get('model_type', 'N/A')}")
    print(f"  Architectures: {config.get('architectures', 'N/A')}")
    print(f"  Tokenizer path: {config.get('tokenizer_name_or_path', 'N/A')}")
    
    # The tokenizer path suggests it's a BERT model with CLIP vision
    # Let's check if we need to load components separately
    
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50 + "\n")

# Approach 3: Try loading with the araclip package but fix the loading
print("--- Approach 3: Fixing araclip package loading ---")
try:
    # The issue is that AraClip.from_pretrained() is trying to load a CLIP model
    # but the actual model is a BERT model. Let's see if we can patch it
    
    from araclip import AraClip
    import torch
    
    print("Trying to understand AraClip class structure...")
    
    # Check the __init__ method
    print("AraClip class methods that might help:")
    araclip_class = AraClip
    
    # Look for methods that might help us load the model correctly
    important_methods = ['from_pretrained', 'load_state_dict', '_load_pretrained_model']
    
    for method in important_methods:
        if hasattr(araclip_class, method):
            print(f"  Found: {method}")
    
    # Let's try to load the model with explicit parameters
    print("\nTrying to load with explicit parameters...")
    
    # Based on the config, we need to load a BERT model
    # But the AraClip wrapper expects CLIP components
    
    # Let's check if we can load the state dict directly
    from huggingface_hub import hf_hub_download
    import safetensors.torch
    
    # Download the model file
    print("Downloading model file...")
    model_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="model.safetensors"
    )
    
    print(f"Model downloaded to: {model_path}")
    
    # Load the state dict
    state_dict = safetensors.torch.load_file(model_path)
    print(f"State dict keys (first 10): {list(state_dict.keys())[:10]}")
    
    # Check if there are CLIP-related keys
    clip_keys = [k for k in state_dict.keys() if 'clip' in k.lower()]
    print(f"CLIP-related keys: {clip_keys[:10]}")
    
    # Check if there are BERT-related keys
    bert_keys = [k for k in state_dict.keys() if 'bert' in k.lower() or 'text' in k.lower()]
    print(f"BERT/text-related keys: {bert_keys[:10]}")
    
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()