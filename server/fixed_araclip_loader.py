import sys
import traceback
import numpy as np
from PIL import Image
import torch

print("Creating fixed AraCLIP loader...")

# Based on the araclip source code analysis, we need to:
# 1. Load the model with pretrained weights for the CLIP vision component
# 2. Ensure the saved state dict is loaded properly

try:
    from araclip import AraClip
    from huggingface_hub import hf_hub_download
    import safetensors.torch
    
    print("✅ Imported required modules")
    
    # Method 1: Try to patch the AraClip class to load with pretrained_hf=True
    print("\n--- Method 1: Patching AraClip class ---")
    
    # First, let's understand the current behavior
    print("Creating AraClip instance with default parameters...")
    
    # The issue is in line 56 of modeling_araclip.py:
    # self.clip_model = create_model("ViT-B-16-SigLIP-512", pretrained_hf=False)
    
    # We need to either:
    # 1. Patch the class to use pretrained_hf=True
    # 2. Load the saved weights after creation
    # 3. Create our own version that loads correctly
    
    # Let's try method 2: Load saved weights
    print("\n--- Method 2: Loading saved weights ---")
    
    # Download the model file
    model_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="model.safetensors"
    )
    
    print(f"Model file: {model_path}")
    
    # Load the state dict
    state_dict = safetensors.torch.load_file(model_path)
    print(f"Loaded state dict with {len(state_dict)} keys")
    
    # Create model instance
    print("Creating model instance...")
    model = AraClip.from_pretrained("Arabic-Clip/araclip")
    
    # Check model state before loading weights
    print("\nChecking model state before loading weights...")
    
    # Try to get the clip_model's state dict keys
    clip_model = model.clip_model
    clip_state_before = clip_model.state_dict()
    print(f"CLIP model has {len(clip_state_before)} parameters")
    
    # Filter state dict for CLIP model weights
    clip_weights = {}
    for key, value in state_dict.items():
        if key.startswith('clip_model.'):
            # Remove the 'clip_model.' prefix
            new_key = key[len('clip_model.'):]
            clip_weights[new_key] = value
    
    print(f"Found {len(clip_weights)} CLIP model weights in saved state dict")
    
    # Check if keys match
    missing_keys = []
    mismatched_keys = []
    
    for key in clip_weights.keys():
        if key not in clip_state_before:
            missing_keys.append(key)
        elif clip_weights[key].shape != clip_state_before[key].shape:
            mismatched_keys.append((key, clip_weights[key].shape, clip_state_before[key].shape))
    
    print(f"Missing keys in current model: {len(missing_keys)}")
    print(f"Mismatched shape keys: {len(mismatched_keys)}")
    
    if missing_keys:
        print("First few missing keys:")
        for key in missing_keys[:5]:
            print(f"  {key}")
    
    if mismatched_keys:
        print("First few mismatched keys:")
        for key, saved_shape, current_shape in mismatched_keys[:5]:
            print(f"  {key}: saved {saved_shape} vs current {current_shape}")
    
    # Try to load the weights
    print("\nAttempting to load CLIP weights...")
    try:
        # Load CLIP model weights
        clip_model.load_state_dict(clip_weights, strict=False)
        print("✅ CLIP model weights loaded (strict=False)")
        
        # Now load the text model weights
        text_weights = {}
        for key, value in state_dict.items():
            if key.startswith('text_model.'):
                new_key = key[len('text_model.'):]
                text_weights[new_key] = value
        
        if text_weights:
            print(f"Found {len(text_weights)} text model weights")
            model.text_model.load_state_dict(text_weights, strict=False)
            print("✅ Text model weights loaded (strict=False)")
        
    except Exception as e:
        print(f"❌ Failed to load weights: {str(e)}")
        traceback.print_exc()
    
    # Test the model
    print("\n--- Testing the fixed model ---")
    
    # Test 1: Text embedding
    print("Test 1: Text embedding")
    arabic_text = "قطة جالسة"  # 'sitting cat'
    
    try:
        text_embedding = model.embed(text=arabic_text)
        print(f"✅ Text embedding generated")
        print(f"  Shape: {text_embedding.shape}")
        print(f"  Type: {type(text_embedding)}")
        print(f"  First 5 values: {text_embedding[:5]}")
    except Exception as e:
        print(f"❌ Text embedding failed: {str(e)}")
    
    # Test 2: Image embedding
    print("\nTest 2: Image embedding")
    test_image = Image.new('RGB', (224, 224), color='red')
    
    try:
        image_embedding = model.embed(image=test_image)
        print(f"✅ Image embedding generated")
        print(f"  Shape: {image_embedding.shape}")
        print(f"  Type: {type(image_embedding)}")
        print(f"  First 5 values: {image_embedding[:5]}")
    except Exception as e:
        print(f"❌ Image embedding failed: {str(e)}")
    
except Exception as e:
    print(f"❌ Overall failure: {str(e)}")
    traceback.print_exc()