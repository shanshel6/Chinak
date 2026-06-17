
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


def main():
    # Load AraCLIP model - try different model names if needed!
    print("[INFO] Loading AraCLIP model...")
    try:
        # Try loading from Hugging Face explicitly
        model = AraClip.from_pretrained("Arabic-Clip/araclip")
        print("[INFO] Model loaded from Hugging Face successfully!")
    except Exception as e1:
        print(f"[WARN] Default model load failed: {str(e1)}")
        try:
            # Try loading from Hugging Face explicitly
            model = AraClip.from_pretrained("Arabic-Clip/araclip")
            print("[INFO] Model loaded from Hugging Face successfully!")
        except Exception as e2:
            print(f"[ERROR] Failed to load AraCLIP model! Both attempts failed.")
            print(f"  Error 1: {str(e1)}")
            print(f"  Error 2: {str(e2)}")
            sys.exit(1)

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
        print(f"\n[INFO] Processing {idx+1}/{len(products)} (ID: {product_id})...")

        # Small delay to avoid rate limiting
        time.sleep(0.1)

        # Load image
        img = load_image_from_url(image_url)
        if img is None:
            print(f"  [SKIP] Failed to load image from URL: {image_url[:50]}...")
            continue
        else:
            print(f"  [OK] Image loaded successfully")

        # Embed image with AraCLIP
        try:
            image_embedding = model.embed(image=img)
            print(f"  [OK] Embedding generated")
            
            if isinstance(image_embedding, np.ndarray):
                embedding_list = image_embedding.tolist()
            else:
                embedding_list = list(image_embedding)

            # Ensure it's 768-dimensional (AraCLIP's native dimension)
            if len(embedding_list) != 768:
                print(f"  [WARNING] Unexpected embedding length: {len(embedding_list)}, skipping...")
                continue
            else:
                print(f"  [OK] Embedding dimension: {len(embedding_list)}")

            # Normalize (just in case)
            norm = np.linalg.norm(embedding_list)
            if norm > 0:
                embedding_list = (np.array(embedding_list) / norm).tolist()
                print(f"  [OK] Embedding normalized (norm: {norm:.4f})")
            else:
                print(f"  [WARNING] Zero norm embedding, skipping...")
                continue

            update_batch.append((embedding_list, product_id))
            print(f"  [SUCCESS] Product {product_id} embedded and added to batch")

        except Exception as e:
            print(f"  [ERROR] Failed to embed product {product_id}: {str(e)}")
            continue

        # Update batch when full
        if len(update_batch) >= batch_size:
            print(f"\n[INFO] Updating {len(update_batch)} products...")
            try:
                execute_batch(cur, """
                    UPDATE "Product" SET "imageEmbedding" = %s::vector WHERE id = %s
                """, update_batch)
                conn.commit()

                progress["last_processed_id"] = product_id
                progress["total_processed"] += len(update_batch)
                save_progress(progress)

                elapsed = time.time() - start_time
                print(f"[INFO] Progress saved! Processed {progress['total_processed']} products in {elapsed:.1f}s.")
            except Exception as db_e:
                print(f"\n  [ERROR] Database update failed: {str(db_e)}")
                conn.rollback()
            update_batch = []

    # Update remaining products in batch
    if update_batch:
        print(f"\n[INFO] Updating last {len(update_batch)} products...")
        try:
            execute_batch(cur, """
                UPDATE "Product" SET "imageEmbedding" = %s::vector WHERE id = %s
            """, update_batch)
            conn.commit()
            progress["total_processed"] += len(update_batch)
            progress["last_processed_id"] = products[-1][0] if products else progress["last_processed_id"]
            save_progress(progress)
        except Exception as db_e:
            print(f"\n  [ERROR] Final database update failed: {str(db_e)}")
            conn.rollback()

    # Cleanup
    cur.close()
    conn.close()

    elapsed_total = time.time() - start_time
    print(f"\n[INFO] Done! Total products processed: {progress['total_processed']}")
    print(f"[INFO] Total time: {elapsed_total:.1f}s")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[FATAL] Script crashed with error: {str(e)}")
        traceback.print_exc()
        sys.exit(1)
