import sys
import traceback

print("Testing TinyCLIP minimal setup...")

try:
    # First, check if we can import transformers
    from transformers import CLIPModel, CLIPProcessor
    import torch
    print("✅ Imported transformers and torch")
    
    # Get model info without downloading
    model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
    print(f"\nModel: {model_name}")
    
    # Check model card/info
    from huggingface_hub import model_info
    info = model_info(model_name)
    
    print(f"✅ Model info retrieved")
    print(f"   Downloads: {info.downloads}")
    print(f"   Likes: {info.likes}")
    print(f"   Last modified: {info.lastModified}")
    
    # Check model files
    print(f"\nModel files:")
    files = info.siblings
    for file in files[:10]:  # Show first 10 files
        print(f"   {file.rfilename} ({file.size} bytes)")
    
    if len(files) > 10:
        print(f"   ... and {len(files) - 10} more files")
    
    # Check config from hub
    from huggingface_hub import hf_hub_download
    import json
    
    print(f"\nDownloading config file...")
    config_path = hf_hub_download(
        repo_id=model_name,
        filename="config.json",
        local_files_only=False
    )
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    print(f"✅ Config loaded")
    print(f"   Model type: {config.get('model_type')}")
    print(f"   Text config: {config.get('text_config', {}).get('hidden_size', 'N/A')}")
    print(f"   Vision config: {config.get('vision_config', {}).get('hidden_size', 'N/A')}")
    print(f"   Projection dim: {config.get('projection_dim', 'N/A')}")
    
    # Check if projection_dim is 512
    projection_dim = config.get('projection_dim')
    if projection_dim == 512:
        print(f"✅ Projection dimension is 512 - perfect for our needs!")
    elif projection_dim:
        print(f"⚠️  Projection dimension is {projection_dim}, not 512")
    else:
        print(f"ℹ️  Projection dimension not specified in config")
    
    print("\n✅ Minimal test completed - model structure looks good!")
    
except ImportError as e:
    print(f"❌ Import error: {str(e)}")
    print("   Make sure transformers and torch are installed:")
    print("   pip install transformers torch pillow huggingface_hub")
    sys.exit(1)
    
except Exception as e:
    print(f"❌ Error: {str(e)}")
    traceback.print_exc()
    sys.exit(1)