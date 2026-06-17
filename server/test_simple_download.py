
import sys
import time
from huggingface_hub import hf_hub_download

print("Testing simple file download...")
model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"

try:
    print("Downloading config.json...")
    config_path = hf_hub_download(
        repo_id=model_name,
        filename="config.json",
        force_download=True
    )
    print(f"✅ config.json downloaded to {config_path}")

    print("\nDownloading preprocessor_config.json...")
    preproc_path = hf_hub_download(
        repo_id=model_name,
        filename="preprocessor_config.json",
        force_download=True
    )
    print(f"✅ preprocessor_config.json downloaded to {preproc_path}")

    print("\nDownloading tokenizer.json...")
    tokenizer_path = hf_hub_download(
        repo_id=model_name,
        filename="tokenizer.json",
        force_download=True
    )
    print(f"✅ tokenizer.json downloaded to {tokenizer_path}")

    print("\nDownloading model.safetensors (this might take a while)...")
    start = time.time()
    model_path = hf_hub_download(
        repo_id=model_name,
        filename="model.safetensors",
        force_download=True
    )
    elapsed = time.time() - start
    print(f"✅ model.safetensors downloaded in {elapsed:.1f} seconds!")

    print("\n✅ All required files downloaded successfully!")

except Exception as e:
    print(f"\n❌ Error: {str(e)}")
    import traceback
    traceback.print_exc()
