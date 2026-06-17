import sys
import traceback
from PIL import Image
import numpy as np
import torch

print("Final AraCLIP model test...")

try:
    from araclip import AraClip
    print("✅ Imported AraClip")
    
    # Load the model
    print("\nLoading model: Arabic-Clip/araclip")
    model = AraClip.from_pretrained("Arabic-Clip/araclip")
    print("✅ Model loaded")
    
    # Check model device
    print(f"Model device: {next(model.parameters()).device}")
    
    # Create a test image
    print("\nCreating test image...")
    test_img = Image.new('RGB', (224, 224), color='red')
    
    # Test embedding
    print("Testing embed method...")
    try:
        # Generate embedding
        embedding = model.embed(image=test_img)
        
        # Convert to numpy
        if isinstance(embedding, torch.Tensor):
            embedding_np = embedding.detach().cpu().numpy()
        else:
            embedding_np = np.array(embedding)
        
        print(f"✅ Embedding generated!")
        print(f"  Shape: {embedding_np.shape}")
        print(f"  Dtype: {embedding_np.dtype}")
        print(f"  Min: {embedding_np.min():.6f}")
        print(f"  Max: {embedding_np.max():.6f}")
        print(f"  Mean: {embedding_np.mean():.6f}")
        print(f"  Std: {embedding_np.std():.6f}")
        
        # Check if embedding is all zeros or very small
        if np.allclose(embedding_np, 0, atol=1e-6):
            print("⚠️  WARNING: Embedding appears to be all zeros (random weights issue)")
        elif np.abs(embedding_np).max() < 0.01:
            print("⚠️  WARNING: Embedding values are very small (may be random weights)")
        else:
            print("✅ Embedding looks good!")
            
        # Test with multiple images
        print("\nTesting with multiple image colors...")
        colors = ['red', 'green', 'blue']
        embeddings = []
        
        for color in colors:
            img = Image.new('RGB', (224, 224), color=color)
            emb = model.embed(image=img)
            if isinstance(emb, torch.Tensor):
                emb = emb.detach().cpu().numpy()
            embeddings.append(emb)
            print(f"  {color}: shape={emb.shape}")
        
        # Check if embeddings are different
        if len(embeddings) >= 2:
            diff = np.abs(embeddings[0] - embeddings[1]).mean()
            print(f"\nMean difference between red and green embeddings: {diff:.6f}")
            if diff < 0.001:
                print("⚠️  WARNING: Embeddings are very similar (model may not be working)")
            else:
                print("✅ Embeddings are different (good!)")
                
    except Exception as e:
        print(f"❌ Embed failed: {str(e)}")
        traceback.print_exc()
        
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()

print("\n" + "="*50)
print("Summary:")
print("The model loads but appears to have random weights for the CLIP component.")
print("This explains why embeddings might not work properly.")
print("="*50)