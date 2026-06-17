import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("Error: DATABASE_URL not found in environment variables!")
    exit(1)

print("Checking database table names...")

try:
    # Connect to database
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    # List all tables in public schema
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    tables = cur.fetchall()
    
    print("\n=== Tables in public schema ===")
    for table in tables:
        print(f"  {table[0]}")
    
    # Also check with information_schema
    print("\n=== Tables from information_schema ===")
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
    """)
    info_tables = cur.fetchall()
    for table in info_tables:
        print(f"  {table[0]}")
    
    cur.close()
    conn.close()
    
except Exception as e:
    print(f"Error: {str(e)}")
    exit(1)