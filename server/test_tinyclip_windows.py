import sys
import traceback
import time

print("Testing TinyCLIP model loading on Windows...")

try:
    # First, let's check if we can download the model config
    from huggingface_hub import hf_hub_download
    import json
    
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    
    print(f"\n1. Downloading config for: {model_name}")
    start_time = time.time()
    try:
        config_path = hf_hub_download(
            repo_id=model_name,
            filename="config.json",
            local_files_only=False
        )
        
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        elapsed = time.time() - start_time
        print(f"✅ Config downloaded in {elapsed:.1f} seconds")
        print(f"   Model type: {config.get('model_type')}")
        print(f"   Architectures: {config.get('architectures')}")
        print(f"   Hidden size: {config.get('hidden_size')}")
        
        # Check if this is a CLIP model
        if config.get('model_type') == 'clip':
            print(f"   ✅ This is a CLIP model")
        else:
            print(f"   ⚠️  Model type is '{config.get('model_type')}', not 'clip'")
            
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"❌ Error downloading config after {elapsed:.1f} seconds: {str(e)}")
        sys.exit(1)
    
    # Now try to load the model
    print(f"\n2. Loading model...")
    start_time = time.time()
    try:
        from transformers import CLIPModel, CLIPProcessor
        
        print("   Downloading model...")
        model = CLIPModel.from_pretrained(model_name)
        print("   Downloading processor...")
        processor = CLIPProcessor.from_pretrained(model_name)
        
        elapsed = time.time() - start_time
        print(f"✅ Model loaded successfully in {elapsed:.1f} seconds!")
        
        # Quick test
        print(f"\n3. Quick embedding test...")
        import torch
        from PIL import Image
        import numpy as np
        
        # Test text embedding
        test_text = "a black sports shoe"
        print(f"   Text: '{test_text}'")
        text_inputs = processor(text=[test_text], return_tensors="pt", padding=True)
        with torch.no_grad():
            text_features = model.get_text_features(**text_inputs)
        text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
        print(f"   Text embedding shape: {text_features.shape}")
        print(f"   Text embedding dimension: {text_features.shape[1]}")
        
        # Create a simple test image (black square)
        test_image = Image.new('RGB', (224, 224), color='black')
        print(f"   Test image: 224x224 black square")
        image_inputs = processor(images=test_image, return_tensors="pt")
        with torch.no_grad():
            image_features = model.get_image_features(**image_inputs)
        image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
        print(f"   Image embedding shape: {image_features.shape}")
        print(f"   Image embedding dimension: {image_features.shape[1]}")
        
        # Check if dimensions match
        if text_features.shape[1] == image_features.shape[1]:
            print(f"✅ Text and image embeddings have same dimension: {text_features.shape[1]}")
            if text_features.shape[1] == 512:
                print(f"✅ Perfect! This matches our 512-dimensional requirement")
            else:
                print(f"⚠️  Dimension is {text_features.shape[1]}, not 512")
        else:
            print(f"❌ Text and image embeddings have different dimensions!")
            print(f"   Text: {text_features.shape[1]}, Image: {image_features.shape[1]}")
        
        print("\n✅ TinyCLIP test completed successfully!")
        
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"❌ Error loading model after {elapsed:.1f} seconds: {str(e)}")
        traceback.print_exc()
        sys.exit(1)
        
except ImportError as e:
    print(f"❌ Import error: {str(e)}")
    print("   Make sure transformers and torch are installed:")
    print("   pip install transformers torch pillow")
    sys.exit(1)
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    traceback.print_exc()
    sys.exit(1)