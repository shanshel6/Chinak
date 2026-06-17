import sys
import traceback

print("Testing TinyCLIP model loading...")

try:
    # First, let's check if we can download the model config
    from huggingface_hub import hf_hub_download
    import json
    
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    
    print(f"\n1. Downloading config for: {model_name}")
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
    
    # Now try to load the model
    print(f"\n2. Loading model...")
    from transformers import CLIPModel, CLIPProcessor
    
    model = CLIPModel.from_pretrained(model_name)
    processor = CLIPProcessor.from_pretrained(model_name)
    
    print(f"✅ Model loaded successfully!")
    
    # Quick test
    print(f"\n3. Quick embedding test...")
    import torch
    from PIL import Image
    
    # Create a test image
    test_img = Image.new('RGB', (224, 224), color='red')
    
    # Process and embed
    inputs = processor(images=test_img, return_tensors="pt")
    with torch.no_grad():
        image_features = model.get_image_features(**inputs)
    
    print(f"   Image embedding shape: {image_features.shape}")
    print(f"   Embedding dimension: {image_features.shape[-1]}")
    
    # Test text embedding
    test_text = "black sports shoes"
    text_inputs = processor(text=test_text, return_tensors="pt", padding=True)
    with torch.no_grad():
        text_features = model.get_text_features(**text_inputs)
    
    print(f"   Text embedding shape: {text_features.shape}")
    
    # Calculate similarity
    image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
    text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
    similarity = (image_features @ text_features.T).item()
    
    print(f"   Similarity score: {similarity:.6f}")
    
    print(f"\n✅ TinyCLIP model is working correctly!")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    traceback.print_exc()