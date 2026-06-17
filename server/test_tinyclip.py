import sys
import traceback
from PIL import Image
import numpy as np
import torch

print("Testing TinyCLIP model...")

try:
    # Try to import transformers and load TinyCLIP
    from transformers import CLIPModel, CLIPProcessor
    
    print("✅ Imported transformers")
    
    # Model name from your recommendation
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    print(f"\nLoading model: {model_name}")
    
    # Load model and processor
    model = CLIPModel.from_pretrained(model_name)
    processor = CLIPProcessor.from_pretrained(model_name)
    
    print("✅ Model loaded successfully!")
    print(f"Model device: {next(model.parameters()).device}")
    
    # Test image embedding
    print("\n=== Testing Image Embedding ===")
    test_img = Image.new('RGB', (224, 224), color='red')
    
    # Process image
    inputs = processor(images=test_img, return_tensors="pt")
    
    # Generate image embedding
    with torch.no_grad():
        image_features = model.get_image_features(**inputs)
    
    # Normalize
    image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
    
    print(f"Image embedding shape: {image_features.shape}")
    print(f"Image embedding dtype: {image_features.dtype}")
    print(f"Image embedding norm: {image_features.norm().item():.6f}")
    
    # Test text embedding
    print("\n=== Testing Text Embedding ===")
    test_text = "black sports shoes"
    
    # Process text
    text_inputs = processor(text=test_text, return_tensors="pt", padding=True)
    
    # Generate text embedding
    with torch.no_grad():
        text_features = model.get_text_features(**text_inputs)
    
    # Normalize
    text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
    
    print(f"Text embedding shape: {text_features.shape}")
    print(f"Text embedding dtype: {text_features.dtype}")
    print(f"Text embedding norm: {text_features.norm().item():.6f}")
    
    # Test similarity
    print("\n=== Testing Similarity ===")
    similarity = (image_features @ text_features.T).item()
    print(f"Similarity between red image and 'black sports shoes': {similarity:.6f}")
    
    # Test with different text
    test_text2 = "red shoes"
    text_inputs2 = processor(text=test_text2, return_tensors="pt", padding=True)
    with torch.no_grad():
        text_features2 = model.get_text_features(**text_inputs2)
    text_features2 = text_features2 / text_features2.norm(p=2, dim=-1, keepdim=True)
    
    similarity2 = (image_features @ text_features2.T).item()
    print(f"Similarity between red image and 'red shoes': {similarity2:.6f}")
    
    # Check model size
    print("\n=== Model Information ===")
    total_params = sum(p.numel() for p in model.parameters())
    print(f"Total parameters: {total_params:,}")
    print(f"Expected: ~23.4 million")
    
    # Check embedding dimension
    print(f"Embedding dimension: {image_features.shape[-1]}")
    print(f"Expected: 512")
    
    print("\n✅ TinyCLIP model test completed successfully!")
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    traceback.print_exc()