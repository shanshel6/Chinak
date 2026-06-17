
import sys
import time
from huggingface_hub import model_info

print("Checking Hugging Face connection...")
start = time.time()

try:
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    print(f"Model: {model_name}")
    info = model_info(model_name)
    elapsed = time.time() - start
    print(f"✅ Model info retrieved in {elapsed:.1f} seconds")
    print(f"Downloads: {info.downloads}, Likes: {info.likes}")
    print(f"Number of files: {len(info.siblings)}")
    
    print("\nAll files:")
    for f in info.siblings:
        print(f"  {f.rfilename} (size: {f.size if f.size else 'unknown'})")
        
except Exception as e:
    print(f"❌ Error: {str(e)}")
    import traceback
    traceback.print_exc()
