import torch
from transformers import AutoModel, AutoTokenizer, AutoImageProcessor
import traceback

print("Testing different model loading approaches...")

# Try loading the model directly as a BERT model
model_name = "Arabic-Clip/araclip"
print(f"\n1. Trying to load {model_name} as AutoModel...")
try:
    model = AutoModel.from_pretrained(model_name)
    print(f"   ✅ Success! Model type: {type(model)}")
    print(f"   Model config architecture: {model.config.architectures}")
    
    # Check if it has the embed method
    if hasattr(model, 'embed'):
        print(f"   Has embed method: Yes")
    else:
        print(f"   Has embed method: No")
        
except Exception as e:
    print(f"   ❌ Failed: {str(e)}")

# Try loading as CLIP model
print(f"\n2. Trying to load {model_name} as CLIPModel...")
try:
    from transformers import CLIPModel
    clip_model = CLIPModel.from_pretrained(model_name)
    print(f"   ✅ Success! Model type: {type(clip_model)}")
    
    # Check model components
    print(f"   Has text_model: {hasattr(clip_model, 'text_model')}")
    print(f"   Has vision_model: {hasattr(clip_model, 'vision_model')}")
    
except Exception as e:
    print(f"   ❌ Failed: {str(e)}")

# Check the actual AraCLIP package
print(f"\n3. Checking AraCLIP package...")
try:
    from araclip import AraClip
    print(f"   ✅ AraClip imported successfully")
    
    # Check what models are available
    print(f"   Trying AraClip.from_pretrained()...")
    try:
        araclip_model = AraClip.from_pretrained()
        print(f"   ✅ AraClip.from_pretrained() worked")
        print(f"   Model type: {type(araclip_model)}")
    except Exception as e:
        print(f"   ❌ AraClip.from_pretrained() failed: {str(e)}")
        
    # Try with explicit model name
    print(f"   Trying AraClip.from_pretrained('Arabic-Clip/araclip')...")
    try:
        araclip_model2 = AraClip.from_pretrained("Arabic-Clip/araclip")
        print(f"   ✅ AraClip.from_pretrained('Arabic-Clip/araclip') worked")
        print(f"   Model type: {type(araclip_model2)}")
    except Exception as e:
        print(f"   ❌ Failed: {str(e)}")
        
except Exception as e:
    print(f"   ❌ Failed to import AraClip: {str(e)}")

# Let's check what the actual AraCLIP model should be
print(f"\n4. Checking for correct AraCLIP model...")
print("   Based on the config, the tokenizer is: Arabic-Clip/bert-base-arabertv2-ViT-B-16-SigLIP-512-epoch-155-trained-2M")
print("   This suggests the actual model might be different.")

# Try to find the correct model
print(f"\n5. Searching for Arabic CLIP models...")
try:
    from huggingface_hub import list_models
    models = list(list_models(filter="arabic-clip", sort="downloads", direction=-1, limit=5))
    print("   Top Arabic CLIP models:")
    for i, model_info in enumerate(models, 1):
        print(f"   {i}. {model_info.modelId} (downloads: {model_info.downloads})")
except Exception as e:
    print(f"   ❌ Failed to search models: {str(e)}")