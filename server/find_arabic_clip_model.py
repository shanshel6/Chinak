import requests
import json

print("Searching for Arabic CLIP models on Hugging Face...")

# Try to find models with "arabic-clip" or similar
search_terms = ["arabic-clip", "arabic clip", "araclip", "arabert clip"]

for term in search_terms:
    print(f"\nSearching for: {term}")
    try:
        url = f"https://huggingface.co/api/models?search={term}&sort=downloads&direction=-1&limit=10"
        response = requests.get(url, timeout=10)
        models = response.json()
        
        if models:
            print(f"Found {len(models)} models:")
            for i, model in enumerate(models[:5], 1):
                print(f"  {i}. {model['modelId']} (downloads: {model.get('downloads', 'N/A')})")
                print(f"     Tags: {model.get('tags', [])}")
        else:
            print("  No models found")
    except Exception as e:
        print(f"  Error: {str(e)}")

# Check the specific model mentioned in the config
print("\n\nChecking the model mentioned in config:")
config_model = "Arabic-Clip/bert-base-arabertv2-ViT-B-16-SigLIP-512-epoch-155-trained-2M"
print(f"Model: {config_model}")

try:
    # Check if this model exists
    url = f"https://huggingface.co/api/models/{config_model}"
    response = requests.get(url, timeout=10)
    if response.status_code == 200:
        model_info = response.json()
        print(f"✅ Model exists!")
        print(f"  Downloads: {model_info.get('downloads', 'N/A')}")
        print(f"  Tags: {model_info.get('tags', [])}")
        
        # Get the config
        config_url = f"https://huggingface.co/{config_model}/raw/main/config.json"
        config_response = requests.get(config_url, timeout=10)
        if config_response.status_code == 200:
            config = config_response.json()
            print(f"\n  Model architecture: {config.get('model_type', 'Unknown')}")
            print(f"  Architectures: {config.get('architectures', [])}")
    else:
        print(f"❌ Model not found or error: {response.status_code}")
except Exception as e:
    print(f"  Error: {str(e)}")

# Let's also check what the AraCLIP package actually expects
print("\n\nChecking AraCLIP package expectations...")
try:
    import araclip
    print("✅ AraCLIP imported")
    
    # Try to see what models it might support
    print("Checking AraClip class...")
    from araclip import AraClip
    
    # Check the from_pretrained method signature
    import inspect
    sig = inspect.signature(AraClip.from_pretrained)
    print(f"from_pretrained signature: {sig}")
    
except Exception as e:
    print(f"Error: {str(e)}")