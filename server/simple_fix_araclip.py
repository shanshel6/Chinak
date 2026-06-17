import sys
import traceback
import numpy as np
from PIL import Image
import torch

print("Simple fix for AraCLIP model loading...")

# The issue: When AraClip.from_pretrained() is called, it creates a CLIP model
# with pretrained_hf=False (random weights), but the saved model file already
# contains the CLIP weights. We need to load them properly.

try:
    from araclip import AraClip
    from huggingface_hub import hf_hub_download
    import safetensors.torch
    
    print("✅ Imported required modules")
    
    # Method: Load the model, then manually load the saved weights
    print("\n--- Step 1: Download model files ---")
    
    # Download config
    config_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="config.json"
    )
    
    # Download model weights
    model_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="model.safetensors"
    )
    
    print(f"Config: {config_path}")
    print(f"Model: {model_path}")
    
    print("\n--- Step 2: Load the state dict ---")
    state_dict = safetensors.torch.load_file(model_path)
    print(f"Loaded state dict with {len(state_dict)} keys")
    
    # Check what keys we have
    print("\nSample keys in state dict:")
    for i, key in enumerate(list(state_dict.keys())[:10]):
        print(f"  {key}: shape={state_dict[key].shape}")
    
    print("\n--- Step 3: Create model instance ---")
    # Create model WITHOUT calling from_pretrained (which causes the issue)
    # Instead, we'll create it manually
    
    import json
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # Create model with the config
    model = AraClip(
        transformer_cfg=config['transformer_cfg'],
        in_features=config['in_features'],
        out_features=config['out_features'],
        tokenizer_repo_id_or_path=config['tokenizer_name_or_path']
    )
    
    print("✅ Model created")
    
    print("\n--- Step 4: Load weights into model ---")
    
    # The state dict keys should match the model's state dict keys
    # Let's check the model's current state dict
    model_state_before = model.state_dict()
    print(f"Model has {len(model_state_before)} parameters before loading")
    
    # Check if keys match
    missing_in_model = []
    missing_in_state = []
    
    for key in state_dict.keys():
        if key not in model_state_before:
            missing_in_model.append(key)
    
    for key in model_state_before.keys():
        if key not in state_dict:
            missing_in_state.append(key)
    
    print(f"Keys in state dict but not in model: {len(missing_in_model)}")
    print(f"Keys in model but not in state dict: {len(missing_in_state)}")
    
    if missing_in_model:
        print("First few keys missing in model:")
        for key in missing_in_model[:5]:
            print(f"  {key}")
    
    if missing_in_state:
        print("First few keys missing in state dict:")
        for key in missing_in_state[:5]:
            print(f"  {key}")
    
    # Try to load the state dict
    print("\nLoading state dict...")
    try:
        model.load_state_dict(state_dict, strict=False)
        print("✅ State dict loaded (strict=False)")
    except Exception as e:
        print(f"❌ Failed to load state dict: {str(e)}")
        traceback.print_exc()
    
    # Test the model
    print("\n--- Testing the model ---")
    
    # Put model in eval mode
    model.eval()
    
    # Test 1: Text embedding
    print("Test 1: Text embedding")
    arabic_text = "قطة جالسة"  # 'sitting cat'
    
    try:
        with torch.no_grad():
            text_embedding = model.embed(text=arabic_text)
        print(f"✅ Text embedding generated")
        print(f"  Shape: {text_embedding.shape}")
        print(f"  Type: {type(text_embedding)}")
        print(f"  First 5 values: {text_embedding[:5]}")
        
        # Check if embedding looks reasonable (not all zeros or random)
        embedding_norm = np.linalg.norm(text_embedding)
        print(f"  Norm: {embedding_norm:.6f}")
        
        if embedding_norm < 0.1 or embedding_norm > 10:
            print(f"  ⚠️ Warning: Embedding norm looks suspicious")
        
    except Exception as e:
        print(f"❌ Text embedding failed: {str(e)}")
        traceback.print_exc()
    
    # Test 2: Image embedding
    print("\nTest 2: Image embedding")
    test_image = Image.new('RGB', (224, 224), color='red')
    
    try:
        with torch.no_grad():
            image_embedding = model.embed(image=test_image)
        print(f"✅ Image embedding generated")
        print(f"  Shape: {image_embedding.shape}")
        print(f"  Type: {type(image_embedding)}")
        print(f"  First 5 values: {image_embedding[:5]}")
        
        # Check if embedding looks reasonable
        embedding_norm = np.linalg.norm(image_embedding)
        print(f"  Norm: {embedding_norm:.6f}")
        
        if embedding_norm < 0.1 or embedding_norm > 10:
            print(f"  ⚠️ Warning: Embedding norm looks suspicious")
        
    except Exception as e:
        print(f"❌ Image embedding failed: {str(e)}")
        traceback.print_exc()
    
except Exception as e:
    print(f"❌ Overall failure: {str(e)}")
    traceback.print_exc()