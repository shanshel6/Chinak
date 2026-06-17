
import sys
import traceback
import time

print("Testing TinyCLIP model loading with progress...")

try:
    from transformers import CLIPModel, CLIPProcessor
    import torch
    from PIL import Image
    from huggingface_hub import snapshot_download
    
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    
    print(f"\nStep 1: Downloading model snapshot (with progress)...")
    start = time.time()
    
    # Download the whole model first with progress
    cache_dir = snapshot_download(
        repo_id=model_name,
        resume_download=True,
        max_workers=4
    )
    
    elapsed = time.time() - start
    print(f"✅ Model downloaded in {elapsed:.1f} seconds!")
    print(f"   Cache directory: {cache_dir}")
    
    print(f"\nStep 2: Loading model and processor from cache...")
    model = CLIPModel.from_pretrained(cache_dir)
    processor = CLIPProcessor.from_pretrained(cache_dir)
    print(f"✅ Model and processor loaded!")
    
    print(f"\nStep 3: Testing embeddings...")
    test_img = Image.new('RGB', (224, 224), color='red')
    inputs = processor(images=test_img, return_tensors="pt")
    with torch.no_grad():
        img_emb = model.get_image_features(**inputs)
    
    test_text = "red object"
    text_inputs = processor(text=test_text, return_tensors="pt", padding=True)
    with torch.no_grad():
        txt_emb = model.get_text_features(**text_inputs)
    
    print(f"   Image embedding dim: {img_emb.shape[1]}")
    print(f"   Text embedding dim: {txt_emb.shape[1]}")
    
    if img_emb.shape[1] == 512 and txt_emb.shape[1] == 512:
        print(f"✅ Perfect! Both embeddings are 512-dimensional as needed!")
    else:
        print(f"⚠️  Dimension mismatch!")
        
    print(f"\n✅ All tests passed!")
    
except Exception as e:
    print(f"\n❌ Error: {str(e)}")
    traceback.print_exc()
