
import sys

print("Step 1: Starting...")
sys.stdout.flush()

print("Step 2: Importing transformers...")
sys.stdout.flush()
from transformers import CLIPModel, CLIPProcessor

print("Step 3: Transformers imported!")
sys.stdout.flush()

model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"

print(f"Step 4: Loading model from {model_name}...")
sys.stdout.flush()
model = CLIPModel.from_pretrained(model_name)

print("Step 5: Model loaded!")
sys.stdout.flush()

print("Step 6: Loading processor...")
sys.stdout.flush()
processor = CLIPProcessor.from_pretrained(model_name)

print("Step 7: Processor loaded!")
sys.stdout.flush()

print("Step 8: Testing imports...")
sys.stdout.flush()
import torch
from PIL import Image

print("Step 9: All imports done!")
sys.stdout.flush()

print("✅ Test passed! Everything is working!")
