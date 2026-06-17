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

print("Checking database schema...")

try:
    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    # Check Product table columns
    print("\n=== Product Table Columns ===")
    cur.execute("""
        SELECT column_name, data_type, character_maximum_length
        FROM information_schema.columns
        WHERE table_name = 'Product'
        ORDER BY ordinal_position
    """)
    
    columns = cur.fetchall()
    for col in columns:
        print(f"  {col[0]}: {col[1]} (max length: {col[2]})")
    
    # Check if vector extensions are installed
    print("\n=== Vector Extension Check ===")
    cur.execute("SELECT extname FROM pg_extension WHERE extname = 'vector'")
    vector_ext = cur.fetchone()
    if vector_ext:
        print(f"  ✅ Vector extension is installed: {vector_ext[0]}")
    else:
        print(f"  ❌ Vector extension is NOT installed")
    
    # Check current embedding column dimensions
    print("\n=== Current Embedding Column Details ===")
    try:
        # Try to get column definition for imageEmbedding
        cur.execute("""
            SELECT attname, atttypmod
            FROM pg_attribute
            WHERE attrelid = 'Product'::regclass
            AND attname = 'imageEmbedding'
        """)
        embedding_col = cur.fetchone()
        if embedding_col:
            print(f"  imageEmbedding column exists")
            # atttypmod contains dimension info for vector type
            if embedding_col[1] > 0:
                dimension = (embedding_col[1] - 4) // 4
                print(f"  Current dimension: {dimension}")
                print(f"  Required dimension: 512")
                if dimension != 512:
                    print(f"  ⚠️  Dimension mismatch! Need to update schema.")
                else:
                    print(f"  ✅ Dimension is correct (512)")
            else:
                print(f"  ℹ️  Dimension info not available in atttypmod")
        else:
            print(f"  ℹ️  imageEmbedding column not found")
    except Exception as e:
        print(f"  ℹ️  Could not check embedding column: {str(e)}")
    
    # Check if textEmbedding column exists
    print("\n=== Text Embedding Column Check ===")
    cur.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'Product'
        AND column_name = 'textEmbedding'
    """)
    text_embedding_col = cur.fetchone()
    if text_embedding_col:
        print(f"  ✅ textEmbedding column exists: {text_embedding_col[0]}")
    else:
        print(f"  ❌ textEmbedding column does NOT exist")
        print(f"  ⚠️  Need to add textEmbedding column for text embeddings")
    
    # Cleanup
    cur.close()
    conn.close()
    
    print("\n=== Schema Update Requirements ===")
    print("Based on the analysis, we need to:")
    print("1. Update imageEmbedding column to 512-dimensional vector")
    print("2. Add textEmbedding column as 512-dimensional vector")
    print("3. Ensure vector extension is installed")
    
except Exception as e:
    print(f"❌ Error checking database schema: {str(e)}")
    import traceback
    traceback.print_exc()