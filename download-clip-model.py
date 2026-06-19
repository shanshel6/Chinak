#!/usr/bin/env python3
"""
Download CLIP model files for bundling with the app
This Python script handles HuggingFace redirects properly
"""

import os
import json
import requests
from pathlib import Path

MODEL_ID = 'Xenova/clip-vit-base-patch32'
OUTPUT_DIR = Path('./public/models/clip')

# Files needed for @xenova/transformers CLIP model
FILES = [
    # Config files
    'config.json',
    'preprocessor_config.json',
    
    # Tokenizer files  
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
    'merges.txt',
    'special_tokens_map.json',
    
    # ONNX model files
    'onnx/text_model_int8.onnx',
    'onnx/config.json',
]

def download_file(url, dest_path):
    """Download a file with proper redirect handling"""
    print(f"  Downloading: {url}")
    
    # Create directory if it doesn't exist
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Use requests with stream=True for large files
    response = requests.get(url, stream=True, allow_redirects=True)
    response.raise_for_status()
    
    # Get total size for progress tracking
    total_size = int(response.headers.get('content-length', 0))
    
    # Download the file
    with open(dest_path, 'wb') as f:
        if total_size == 0:
            # No content-length header
            f.write(response.content)
        else:
            # Download with progress
            downloaded = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    # Print progress every 5MB
                    if downloaded % (5 * 1024 * 1024) == 0:
                        mb_downloaded = downloaded / (1024 * 1024)
                        mb_total = total_size / (1024 * 1024)
                        print(f"    Progress: {mb_downloaded:.1f}/{mb_total:.1f} MB")
    
    return dest_path.stat().st_size

def main():
    print("📦 Downloading CLIP TEXT model files...\n")
    print(f"Model: {MODEL_ID}")
    print(f"Output: {OUTPUT_DIR}\n")
    
    success = 0
    failed = 0
    total_size = 0
    
    for file in FILES:
        url = f"https://huggingface.co/{MODEL_ID}/resolve/main/{file}"
        dest_path = OUTPUT_DIR / file
        
        print(f"📥 {file}...")
        
        try:
            size = download_file(url, dest_path)
            mb_size = size / (1024 * 1024)
            print(f"   ✅ {mb_size:.2f} MB")
            success += 1
            total_size += size
            
            # Check if file is valid JSON (for config files)
            if file.endswith('.json'):
                try:
                    with open(dest_path, 'r', encoding='utf-8') as f:
                        json.load(f)
                    print(f"   ✓ Valid JSON")
                except json.JSONDecodeError:
                    print(f"   ⚠️  Invalid JSON content")
                    # Read first 200 chars to see what's wrong
                    with open(dest_path, 'r', encoding='utf-8') as f:
                        content = f.read(200)
                        print(f"   Content preview: {content}")
                    
        except Exception as e:
            print(f"   ❌ Failed: {str(e)}")
            failed += 1
    
    print('\n' + '=' * 50)
    print(f"Downloaded: {success}/{len(FILES)} files")
    print(f"Total size: {total_size / (1024 * 1024):.2f} MB")
    if failed > 0:
        print(f"Failed: {failed} files")
    print('=' * 50)
    
    # Create a test file to verify the model can be loaded
    print("\n🔍 Creating test file to verify model loading...")
    test_file = OUTPUT_DIR / "test_loading.js"
    test_content = """
// Test if the model can be loaded locally
const { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection } = require('@xenova/transformers');

async function testModel() {
    console.log('Testing model loading from:', process.cwd() + '/models/clip');
    
    try {
        const processor = await AutoProcessor.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Processor loaded');
        
        const tokenizer = await AutoTokenizer.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Tokenizer loaded');
        
        const textModel = await CLIPTextModelWithProjection.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Text model loaded');
        
        console.log('🎉 All models loaded successfully!');
        return true;
    } catch (error) {
        console.error('❌ Failed to load model:', error.message);
        return false;
    }
}

testModel();
"""
    
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
    
    print(f"Test file created: {test_file}")
    print("Run: node public/models/clip/test_loading.js")

if __name__ == '__main__':
    main()