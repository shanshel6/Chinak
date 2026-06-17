import os
import sys
import json
import time
import numpy as np
from PIL import Image
import requests
from io import BytesIO
import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv
import traceback
import torch

# Try to import AraCLIP
try:
    from araclip import AraClip
except ImportError:
    print("Error: AraCLIP not installed!")
    print("Please install it with: pip install git+https://github.com/Arabic-Clip/Araclip.git")
    sys.exit(1)

# Load environment variables
load_dotenv()

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not found in environment variables!")
    sys.exit(1)

# Progress file
PROGRESS_FILE = "arabic_clip_embedding_progress.json"

# Headers for image downloading (to avoid 420 errors)
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/jpeg,image/png,image/*;q=0.8',
    'Connection': 'keep-alive'
}


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"last_processed_id": 0, "total_processed": 0}


def save_progress(progress):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)


def load_image_from_url(url):
    try:
        response = requests.get(url, timeout=30, headers=HEADERS)
        response.raise_for_status()
        img = Image.open(BytesIO(response.content)).convert("RGB")
        return img
    except Exception as e:
        print(f"  [ERROR] Failed to load image from {url}: {str(e)}")
        return None


def load_araclip_model_fixed():
    """Load AraCLIP model with proper weight loading"""
    print("[INFO] Loading AraCLIP model with fixed weight loading...")
    
    try:
        # First, try to load the model normally
        model = AraClip.from_pretrained("Arabic-Clip/araclip")
        print("[INFO] Model loaded from Hugging Face")
        
        # The issue: The CLIP model inside AraClip is initialized with random weights
        # because create_model("ViT-B-16-SigLIP-512", pretrained_hf=False) is used
        
        # We need to manually load the saved weights
        # Download the model file directly
        from huggingface_hub import hf_hub_download
        import safetensors.torch
        
        print("[INFO] Downloading model weights...")
        model_path = hf_hub_download(
            repo_id="Arabic-Clip/araclip",
            filename="model.safetensors"
        )
        
        print("[INFO] Loading state dict...")
        state_dict = safetensors.torch.load_file(model_path)
        print(f"[INFO] Loaded state dict with {len(state_dict)} keys")
        
        # Load the weights into the model
        # Use strict=False because there might be some missing keys
        missing_keys, unexpected_keys = model.load_state_dict(state_dict, strict=False)
        
        print(f"[INFO] Weights loaded. Missing keys: {len(missing_keys)}, Unexpected keys: {len(unexpected_keys)}")
        
        if missing_keys:
            print("[WARN] Some keys were missing during loading:")
            for key in missing_keys[:5]:
                print(f"  - {key}")
            if len(missing_keys) > 5:
                print(f"  ... and {len(missing_keys) - 5} more")
        
        if unexpected_keys:
            print("[WARN] Some unexpected keys were found:")
            for key in unexpected_keys[:5]:
                print(f"  - {key}")
            if len(unexpected_keys) > 5:
                print(f"  ... and {len(unexpected_keys) - 5} more")
        
        # Put model in evaluation mode
        model.eval()
        print("[INFO] Model is ready for inference!")
        
        return model
        
    except Exception as e:
        print(f"[ERROR] Failed to load model: {str(e)}")
        traceback.print_exc()
        sys.exit(1)


def main():
    # Load AraCLIP model with fixed loading
    model = load_araclip_model_fixed()

    # Connect to database
    print("[INFO] Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Load progress
    progress = load_progress()
    print(f"[INFO] Starting from product ID: {progress['last_processed_id']}")
    print(f"[INFO] Total processed so far: {progress['total_processed']}")

    # Get products to process
    cur.execute("""
        SELECT id, image, name
        FROM "Product"
        WHERE id > %s
          AND image IS NOT NULL
          AND image != ''
        ORDER BY id ASC
    """, (progress["last_processed_id"],))
    products = cur.fetchall()
    print(f"[INFO] Found {len(products)} products to process!")

    batch_size = 50
    update_batch = []
    start_time = time.time()

    for idx, (product_id, image_url, product_name) in enumerate(products):
        print(f"\r[INFO] Processing {idx+1}/{len(products)} (ID: {product_id})...", end="")

        # Small delay to avoid rate limiting
        time.sleep(0.1)

        # Load image
        img = load_image_from_url(image_url)
        if img is None:
            continue

        # Embed image with AraCLIP
        try:
            with torch.no_grad():
                image_embedding = model.embed(image=img)
            
            if isinstance(image_embedding, np.ndarray):
                embedding_list = image_embedding.tolist()
            else:
                embedding_list = list(image_embedding)

            # Ensure it's 768-dimensional (AraCLIP's native dimension)
            if len(embedding_list) != 768:
                print(f"\n  [WARNING] Unexpected embedding length: {len(embedding_list)}, skipping...")
                continue

            # Normalize (just in case)
            norm = np.linalg.norm(embedding_list)
            if norm > 0:
                embedding_list = (np.array(embedding_list) / norm).tolist()

            update_batch.append((embedding_list, product_id))

        except Exception as e:
            print(f"\n  [ERROR] Failed to embed product {product_id}: {str(e)}")
            continue

        # Update batch when full
        if len(update_batch) >= batch_size:
            print(f"\n[INFO] Updating {len(update_batch)} products...")
            try:
                execute_batch(cur, """
                    UPDATE "Product"
                    SET "imageEmbedding" = %s
                    WHERE id = %s
                """, update_batch)
                conn.commit()
                
                # Update progress
                last_id = update_batch[-1][1]
                progress["last_processed_id"] = last_id
                progress["total_processed"] += len(update_batch)
                save_progress(progress)
                
                update_batch = []
                
                # Calculate estimated time remaining
                elapsed = time.time() - start_time
                items_per_second = (idx + 1) / elapsed if elapsed > 0 else 0
                remaining = len(products) - (idx + 1)
                eta_seconds = remaining / items_per_second if items_per_second > 0 else 0
                eta_minutes = eta_seconds / 60
                
                print(f"[INFO] Batch committed. ETA: {eta_minutes:.1f} minutes remaining")
                
            except Exception as e:
                print(f"\n[ERROR] Failed to update batch: {str(e)}")
                conn.rollback()

    # Update any remaining products
    if update_batch:
        print(f"\n[INFO] Updating final batch of {len(update_batch)} products...")
        try:
            execute_batch(cur, """
                UPDATE "Product"
                SET "imageEmbedding" = %s
                WHERE id = %s
            """, update_batch)
            conn.commit()
            
            # Update progress
            last_id = update_batch[-1][1]
            progress["last_processed_id"] = last_id
            progress["total_processed"] += len(update_batch)
            save_progress(progress)
            
            print("[INFO] Final batch committed!")
            
        except Exception as e:
            print(f"\n[ERROR] Failed to update final batch: {str(e)}")
            conn.rollback()

    # Close connections
    cur.close()
    conn.close()
    
    total_time = time.time() - start_time
    print(f"\n[INFO] Done! Processed {progress['total_processed']} products in {total_time:.1f} seconds")
    print(f"[INFO] Average: {progress['total_processed'] / total_time:.2f} products/second")


if __name__ == "__main__":
    main()