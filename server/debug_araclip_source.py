import sys
import os

# Add the araclip package to path to inspect it
import araclip

print("Inspecting araclip package source...")

# Find where araclip is installed
print(f"araclip module location: {araclip.__file__}")

# Try to find the source code
araclip_dir = os.path.dirname(araclip.__file__)
print(f"araclip directory: {araclip_dir}")

# List files in the directory
print("\nFiles in araclip directory:")
for file in os.listdir(araclip_dir):
    print(f"  {file}")

# Check if there's a modeling file
modeling_file = os.path.join(araclip_dir, "modeling_araclip.py")
if os.path.exists(modeling_file):
    print(f"\nFound modeling file: {modeling_file}")
    
    # Read the first 100 lines to understand the structure
    with open(modeling_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()[:100]
        print("\nFirst 100 lines of modeling_araclip.py:")
        for i, line in enumerate(lines, 1):
            print(f"{i:3}: {line.rstrip()}")
else:
    print("\nNo modeling_araclip.py found")

# Check the __init__.py file
init_file = os.path.join(araclip_dir, "__init__.py")
if os.path.exists(init_file):
    print(f"\n__init__.py contents:")
    with open(init_file, 'r', encoding='utf-8') as f:
        content = f.read()
        print(content[:500])  # First 500 chars