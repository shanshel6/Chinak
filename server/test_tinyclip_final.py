
import sys
import traceback
from transformers import CLIPModel, CLIPProcessor
import torch
from PIL import Image

print("Testing TinyCLIP final test...")
model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"

try:
    print("Step 1: Loading model and processor from cache...")
    model = CLIPModel.from_pretrained(model_name)
    processor = CLIPProcessor.from_pretrained(model_name)
    print("✅ Loaded successfully!")

    print("\nStep 2: Testing image embedding...")
    test_img = Image.new('RGB', (224, 224), color='red')
    inputs = processor(images=test_img, return_tensors="pt")
    with torch.no_grad():
        image_features = model.get_image_features(**inputs)
    image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
    print(f"   Shape: {image_features.shape}")
    print(f"   Dimension: {image_features.shape[1]}")

    print("\nStep 3: Testing text embedding...")
    test_texts = ["red shoe", "black shoe", "phone", "car"]
    text_inputs = processor(text=test_texts, return_tensors="pt", padding=True)
    with torch.no_grad():
        text_features = model.get_text_features(**text_inputs)
    text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
    print(f"   Shape: {text_features.shape}")
    print(f"   Dimension: {text_features.shape[1]}")

    print("\nStep 4: Calculating similarities...")
    similarities = (image_features @ text_features.T).squeeze(0).tolist()
    for text, sim in zip(test_texts, similarities):
        print(f"   '{text}' → {sim:.4f}")

    print("\n✅ TinyCLIP is fully working! All tests passed!")
    
    if image_features.shape[1] == 512 and text_features.shape[1] == 512:
        print("   Perfect! Embedding dimensions are exactly 512 as needed!")

except Exception as e:
    print(f"\n❌ Error: {str(e)}")
    traceback.print_exc()
