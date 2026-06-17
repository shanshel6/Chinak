import sys
import traceback
import signal
from contextlib import contextmanager

class TimeoutException(Exception):
    pass

@contextmanager
def time_limit(seconds):
    def signal_handler(signum, frame):
        raise TimeoutException("Timed out!")
    signal.signal(signal.SIGALRM, signal_handler)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)

print("Testing TinyCLIP model loading with timeout (120 seconds)...")

try:
    # First, let's check if we can download the model config
    from huggingface_hub import hf_hub_download
    import json
    
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    
    print(f"\n1. Downloading config for: {model_name}")
    try:
        with time_limit(30):
            config_path = hf_hub_download(
                repo_id=model_name,
                filename="config.json",
                local_files_only=False
            )
        
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        print(f"✅ Config downloaded")
        print(f"   Model type: {config.get('model_type')}")
        print(f"   Architectures: {config.get('architectures')}")
        print(f"   Hidden size: {config.get('hidden_size')}")
    except TimeoutException:
        print("❌ Config download timed out after 30 seconds")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error downloading config: {str(e)}")
        sys.exit(1)
    
    # Now try to load the model
    print(f"\n2. Loading model (90 second timeout)...")
    try:
        with time_limit(90):
            from transformers import CLIPModel, CLIPProcessor
            
            print("   Downloading model...")
            model = CLIPModel.from_pretrained(model_name)
            print("   Downloading processor...")
            processor = CLIPProcessor.from_pretrained(model_name)
        
        print(f"✅ Model loaded successfully!")
        
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
        else:
            print(f"❌ Text and image embeddings have different dimensions!")
            print(f"   Text: {text_features.shape[1]}, Image: {image_features.shape[1]}")
        
        print("\n✅ TinyCLIP test completed successfully!")
        
    except TimeoutException:
        print("❌ Model loading timed out after 90 seconds")
        print("   This might be due to network issues or large model size")
        print("   You can try:")
        print("   1. Check your internet connection")
        print("   2. Try again later")
        print("   3. Use a smaller model if available")
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