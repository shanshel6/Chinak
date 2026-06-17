
import sys
import time

print("[1] Starting script...", flush=True)

print("[2] Importing os, dotenv...", flush=True)
import os
from dotenv import load_dotenv

print("[3] Loading env...", flush=True)
load_dotenv()

print("[4] Importing transformers...", flush=True)
from transformers import CLIPModel, CLIPProcessor
print("[5] Transformers imported!", flush=True)

model_name = "wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M"
print(f"[6] Loading model from {model_name}...", flush=True)

start_time = time.time()
model = CLIPModel.from_pretrained(model_name)
print(f"[7] Model loaded in {time.time()-start_time:.1f}s!", flush=True)

print("[8] Loading processor...", flush=True)
processor = CLIPProcessor.from_pretrained(model_name)
print("[9] Processor loaded!", flush=True)

print("[10] All good! Model and processor are ready!", flush=True)
