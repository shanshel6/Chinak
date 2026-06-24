import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not found in environment variables!")
    sys.exit(1)

print("Updating database schema for CLIP embeddings...")

try:
    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False  # Use transactions
    cur = conn.cursor()
    
    print("1. Checking vector extension...")
    cur.execute("SELECT extname FROM pg_extension WHERE extname = 'vector'")
    vector_ext = cur.fetchone()
    if vector_ext:
        print(f"   ✅ Vector extension is already installed: {vector_ext[0]}")
    else:
        print("   ⚠️  Vector extension not found. Installing...")
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        print("   ✅ Vector extension installed")
    
    print("\n2. Updating imageEmbedding column to vector(512)...")
    try:
        # Check current dimension
        cur.execute("""
            SELECT attname, atttypmod
            FROM pg_attribute
            WHERE attrelid = '"Product"'::regclass
            AND attname = 'imageEmbedding'
        """)
        embedding_col = cur.fetchone()
        
        if embedding_col:
            if embedding_col[1] > 0:
                current_dim = (embedding_col[1] - 4) // 4
                print(f"   Current dimension: {current_dim}")
                
                if current_dim != 512:
                    print(f"   Updating from {current_dim} to 512 dimensions...")
                    # Alter the column type
                    cur.execute('ALTER TABLE "Product" ALTER COLUMN "imageEmbedding" TYPE vector(512)')
                    print("   ✅ imageEmbedding column updated to vector(512)")
                else:
                    print("   ✅ imageEmbedding column already has correct dimension (512)")
            else:
                print("   ℹ️  Dimension info not available, updating to vector(512)...")
                cur.execute('ALTER TABLE "Product" ALTER COLUMN "imageEmbedding" TYPE vector(512)')
                print("   ✅ imageEmbedding column updated to vector(512)")
        else:
            print("   ℹ️  imageEmbedding column not found, creating it...")
            cur.execute('ALTER TABLE "Product" ADD COLUMN "imageEmbedding" vector(512)')
            print("   ✅ imageEmbedding column created as vector(512)")
    except Exception as e:
        print(f"   ❌ Error updating imageEmbedding column: {str(e)}")
        conn.rollback()
        raise
    
    print("\n3. Adding textEmbedding column as vector(512)...")
    try:
        # Check if column already exists
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'Product'
            AND column_name = 'textEmbedding'
        """)
        text_embedding_col = cur.fetchone()
        
        if text_embedding_col:
            print("   ✅ textEmbedding column already exists")
            # Check its dimension
            cur.execute("""
                SELECT attname, atttypmod
                FROM pg_attribute
                WHERE attrelid = '"Product"'::regclass
                AND attname = 'textEmbedding'
            """)
            text_col_info = cur.fetchone()
            if text_col_info and text_col_info[1] > 0:
                current_dim = (text_col_info[1] - 4) // 4
                if current_dim != 512:
                    print(f"   ⚠️  textEmbedding has wrong dimension ({current_dim}), updating to 512...")
                    cur.execute('ALTER TABLE "Product" ALTER COLUMN "textEmbedding" TYPE vector(512)')
                    print("   ✅ textEmbedding column updated to vector(512)")
                else:
                    print("   ✅ textEmbedding column already has correct dimension (512)")
        else:
            print("   Adding textEmbedding column...")
            cur.execute('ALTER TABLE "Product" ADD COLUMN "textEmbedding" vector(512)')
            print("   ✅ textEmbedding column added as vector(512)")
    except Exception as e:
        print(f"   ❌ Error adding textEmbedding column: {str(e)}")
        conn.rollback()
        raise
    
    # Commit all changes
    conn.commit()
    print("\n✅ Database schema updated successfully!")
    
    # Verify the changes
    print("\n=== Verification ===")
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'Product'
        AND column_name IN ('imageEmbedding', 'textEmbedding')
        ORDER BY column_name
    """)
    for col in cur.fetchall():
        print(f"  {col[0]}: {col[1]}")
    
    cur.close()
    conn.close()
    
except Exception as e:
    print(f"\n❌ Error updating database schema: {str(e)}")
    import traceback
    traceback.print_exc()
    sys.exit(1)