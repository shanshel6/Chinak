
import os
import json
import psycopg2
import numpy as np
from dotenv import load_dotenv

print("Checking embedded products (Python)...")

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not found in .env")
    exit(1)

product_ids = [356, 357, 358, 360, 362, 364, 365, 366, 367, 368, 369, 370]

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    for product_id in product_ids:
        print(f"\nProduct ID: {product_id}")

        cur.execute("""
            SELECT id, name, "imageEmbedding", "textEmbedding"
            FROM "Product"
            WHERE id = %s
        """, (product_id,))
        row = cur.fetchone()

        if row:
            product_id, name, image_embedding, text_embedding = row
            print(f"Name: {name}")

            if image_embedding is not None:
                # If it's a string, parse it as JSON first
                img_emb = image_embedding
                if isinstance(img_emb, str):
                    img_emb = json.loads(img_emb.replace("'", "\""))

                print(f"✅ Image Embedding Found ({len(img_emb)} dimensions)")
                if len(img_emb) == 512:
                    print(f"   Correct dimension: 512")
                else:
                    print(f"   Wrong dimension: expected 512, got {len(img_emb)}")
                # Convert to floats
                first_5 = [float(v) for v in img_emb[:5]]
                print(f"   First 5 values: {[round(v, 6) for v in first_5]}")
            else:
                print("❌ No image embedding")

            if text_embedding is not None:
                txt_emb = text_embedding
                if isinstance(txt_emb, str):
                    txt_emb = json.loads(txt_emb.replace("'", "\""))
                print(f"✅ Text Embedding Found ({len(txt_emb)} dimensions)")
                if len(txt_emb) == 512:
                    print(f"   Correct dimension: 512")
                else:
                    print(f"   Wrong dimension: expected 512, got {len(txt_emb)}")
                first_5_txt = [float(v) for v in txt_emb[:5]]
                print(f"   First 5 values: {[round(v,6) for v in first_5_txt]}")
            else:
                print("❌ No text embedding")
        else:
            print("❌ Product not found in database")

    cur.close()
    conn.close()
    print("\n✅ Done checking products!")

except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
