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

# Try to import transformers for TinyCLIP
try:
    from transformers import CLIPModel, CLIPProcessor
    import torch
    print("✅ Imported transformers and torch")
except ImportError:
    print("Error: transformers or torch not installed!")
    print("Please install with: pip install transformers torch pillow")
    sys.exit(1)

# Try to import translation library
try:
    # Use translate library (compatible with Python 3.14+)
    from translate import Translator
    print("✅ Imported translation library (translate)")
    translator_instance = Translator(to_lang="en", from_lang="ar")
except ImportError:
    print("Warning: translate library not installed. Text translation will be skipped.")
    print("Install with: pip install translate")
    translator_instance = None

# Load environment variables
load_dotenv()

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not found in environment variables!")
    sys.exit(1)

# Progress file
PROGRESS_FILE = "tinyclip_embedding_progress.json"

# Headers for image downloading (to avoid 420 errors)
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/jpeg,image/png,image/*;q=0.8',
    'Connection': 'keep-alive'
}

# Translation cache to avoid repeated translations
translation_cache = {}

def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"last_processed_id": 0, "total_processed": 0, "image_embeddings": 0, "text_embeddings": 0}

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
        print(f"  [ERROR] Failed to load image from {url[:50]}...: {str(e)}")
        return None

def translate_arabic_to_english(text):
    """Translate Arabic text to English"""
    if not text or not translator_instance:
        return text
    
    # Check cache first
    if text in translation_cache:
        return translation_cache[text]
    
    try:
        translation = translator_instance.translate(text)
        translation_cache[text] = translation
        return translation
    except Exception as e:
        print(f"  [WARNING] Translation failed for '{text[:50]}...': {str(e)}")
        return text

def generate_image_embedding(model, processor, image):
    """Generate embedding for an image"""
    try:
        # Process image
        inputs = processor(images=image, return_tensors="pt")
        
        # Generate embedding
        with torch.no_grad():
            image_features = model.get_image_features(**inputs)
        
        # Normalize
        image_features = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
        
        # Convert to numpy array
        embedding = image_features.cpu().numpy().flatten()
        
        return embedding
    except Exception as e:
        print(f"  [ERROR] Image embedding generation failed: {str(e)}")
        return None

def generate_text_embedding(model, processor, text):
    """Generate embedding for text"""
    try:
        # Process text
        inputs = processor(text=text, return_tensors="pt", padding=True)
        
        # Generate embedding
        with torch.no_grad():
            text_features = model.get_text_features(**inputs)
        
        # Normalize
        text_features = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
        
        # Convert to numpy array
        embedding = text_features.cpu().numpy().flatten()
        
        return embedding
    except Exception as e:
        print(f"  [ERROR] Text embedding generation failed for '{text[:50]}...': {str(e)}")
        return None

def main():
    # Load TinyCLIP model
    print("[INFO] Loading TinyCLIP model...")
    try:
        model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
        model = CLIPModel.from_pretrained(model_name)
        processor = CLIPProcessor.from_pretrained(model_name)
        print(f"[INFO] TinyCLIP model loaded successfully!")
        
        # Move model to GPU if available
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = model.to(device)
        print(f"[INFO] Model loaded on device: {device}")
        
    except Exception as e:
        print(f"[ERROR] Failed to load TinyCLIP model: {str(e)}")
        traceback.print_exc()
        sys.exit(1)

    # Connect to database
    print("[INFO] Connecting to database...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Load progress
    progress = load_progress()
    print(f"[INFO] Starting from product ID: {progress['last_processed_id']}")
    print(f"[INFO] Total processed so far: {progress['total_processed']}")
    print(f"[INFO] Image embeddings generated: {progress['image_embeddings']}")
    print(f"[INFO] Text embeddings generated: {progress['text_embeddings']}")

    # Get products to process
    cur.execute("""
        SELECT id, image, name, description
        FROM "Product"
        WHERE id > %s
          AND image IS NOT NULL
          AND image != ''
        ORDER BY id ASC
    """, (progress["last_processed_id"],))
    products = cur.fetchall()
    print(f"[INFO] Found {len(products)} products to process!")

    batch_size = 20
    update_batch = []
    start_time = time.time()
    successful_embeddings = 0

    for idx, (product_id, image_url, product_name, description) in enumerate(products):
        print(f"\n[INFO] Processing {idx+1}/{len(products)} (ID: {product_id})...")
        
        # Small delay to avoid rate limiting
        time.sleep(0.1)

        # Load image
        img = load_image_from_url(image_url)
        if img is None:
            print(f"  [SKIP] Failed to load image, skipping product {product_id}")
            continue
        
        print(f"  [OK] Image loaded successfully")

        # Generate image embedding
        print(f"  [INFO] Generating image embedding...")
        image_embedding = generate_image_embedding(model, processor, img)
        
        if image_embedding is None:
            print(f"  [SKIP] Failed to generate image embedding, skipping product {product_id}")
            continue
        
        print(f"  [OK] Image embedding generated (dimension: {len(image_embedding)})")
        
        # Generate text embedding if we have text
        text_embedding = None
        combined_text = ""
        
        if product_name or description:
            # Combine name and description
            if product_name:
                combined_text += product_name + " "
            if description:
                combined_text += description
            
            # Translate Arabic to English
            print(f"  [INFO] Translating text to English...")
            translated_text = translate_arabic_to_english(combined_text.strip())
            
            if translated_text and translated_text != combined_text.strip():
                print(f"  [OK] Text translated: '{translated_text[:50]}...'")
            elif translated_text:
                print(f"  [INFO] Text already in English or translation skipped")
            
            # Generate text embedding
            print(f"  [INFO] Generating text embedding...")
            text_embedding = generate_text_embedding(model, processor, translated_text)
            
            if text_embedding is not None:
                print(f"  [OK] Text embedding generated (dimension: {len(text_embedding)})")
            else:
                print(f"  [WARNING] Failed to generate text embedding")
        
        # Prepare data for database update
        # We'll store both embeddings as JSON arrays
        image_embedding_list = image_embedding.tolist() if image_embedding is not None else None
        text_embedding_list = text_embedding.tolist() if text_embedding is not None else None
        
        update_batch.append((image_embedding_list, text_embedding_list, product_id))
        successful_embeddings += 1
        
        print(f"  [SUCCESS] Product {product_id} processed successfully")

        # Update batch when full
        if len(update_batch) >= batch_size:
            print(f"\n[INFO] Updating {len(update_batch)} products in database...")
            try:
                execute_batch(cur, """
                    UPDATE "Product" 
                    SET "imageEmbedding" = %s::vector,
                        "textEmbedding" = %s::vector
                    WHERE id = %s
                """, update_batch)
                conn.commit()

                # Update progress
                progress["last_processed_id"] = product_id
                progress["total_processed"] += len(update_batch)
                progress["image_embeddings"] += len(update_batch)
                if any(item[1] for item in update_batch):  # Count text embeddings
                    progress["text_embeddings"] += sum(1 for item in update_batch if item[1] is not None)
                
                save_progress(progress)

                elapsed = time.time() - start_time
                print(f"[INFO] Progress saved! Processed {progress['total_processed']} products in {elapsed:.1f}s.")
                print(f"[INFO] Successful embeddings: {successful_embeddings}")
                
            except Exception as db_e:
                print(f"  [ERROR] Database update failed: {str(db_e)}")
                traceback.print_exc()
                conn.rollback()
            
            update_batch = []

    # Update remaining products in batch
    if update_batch:
        print(f"\n[INFO] Updating last {len(update_batch)} products...")
        try:
            execute_batch(cur, """
                UPDATE "Product" 
                SET "imageEmbedding" = %s::vector,
                    "textEmbedding" = %s::vector
                WHERE id = %s
            """, update_batch)
            conn.commit()
            
            progress["total_processed"] += len(update_batch)
            progress["image_embeddings"] += len(update_batch)
            if any(item[1] for item in update_batch):
                progress["text_embeddings"] += sum(1 for item in update_batch if item[1] is not None)
            progress["last_processed_id"] = products[-1][0] if products else progress["last_processed_id"]
            save_progress(progress)
            
        except Exception as db_e:
            print(f"  [ERROR] Final database update failed: {str(db_e)}")
            traceback.print_exc()
            conn.rollback()

    # Cleanup
    cur.close()
    conn.close()

    elapsed_total = time.time() - start_time
    print(f"\n[INFO] Done! Total products processed: {progress['total_processed']}")
    print(f"[INFO] Image embeddings generated: {progress['image_embeddings']}")
    print(f"[INFO] Text embeddings generated: {progress['text_embeddings']}")
    print(f"[INFO] Total time: {elapsed_total:.1f}s")
    print(f"[INFO] Average time per product: {elapsed_total/max(1, progress['total_processed']):.2f}s")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[INFO] Script interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n[FATAL] Script crashed with error: {str(e)}")
        traceback.print_exc()
        sys.exit(1)