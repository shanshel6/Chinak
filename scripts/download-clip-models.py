"""
Run this script ONCE during development to download CLIP models
into public/models/clip/ so they get bundled with the app.

Run: python scripts/download-clip-models.py
"""

import os
import urllib.request
import sys

MODEL_ID = "Xenova/clip-vit-base-patch32"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "models", "clip")

FILES = [
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
    "special_tokens_map.json",
    "onnx/text_model_int8.onnx",
    "onnx/config.json",
]

def download_file(url, dest_path, retries=3):
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; AppBundleBuilder/1.0)"
            })
            with urllib.request.urlopen(req, timeout=120) as response:
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with open(dest_path, "wb") as f:
                    f.write(response.read())
            return True
        except Exception as e:
            print(f"   ⚠️ Attempt {attempt}/{retries} failed: {e}")
            if attempt < retries:
                import time
                time.sleep(2)
            else:
                return False
    return False

def main():
    print(f"📦 Downloading CLIP models for app bundling...\n")
    print(f"Output: {OUTPUT_DIR}\n")

    success = 0
    failed = 0

    for file in FILES:
        url = f"https://huggingface.co/{MODEL_ID}/resolve/main/{file}"
        dest_path = os.path.join(OUTPUT_DIR, file)

        # Skip if exists
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1000:
            mb = os.path.getsize(dest_path) / 1024 / 1024
            print(f"⏭️  {file} (already exists, {mb:.2f} MB)")
            success += 1
            continue

        print(f"📥 {file}... ", end="", flush=True)

        if download_file(url, dest_path):
            size = os.path.getsize(dest_path)
            print(f"✅ {size / 1024 / 1024:.2f} MB")
            success += 1
        else:
            print("❌ Failed")
            failed += 1

    print("\n" + "=" * 50)
    print(f"Done: {success}/{len(FILES)} files")
    if failed > 0:
        print(f"Failed: {failed} files")

    # Calculate total size
    total = 0
    for root, dirs, files in os.walk(OUTPUT_DIR):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except:
                pass
    print(f"Total size: {total / 1024 / 1024:.2f} MB")
    print("=" * 50)

if __name__ == "__main__":
    main()