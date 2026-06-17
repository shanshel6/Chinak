import sys
import traceback
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torchvision.transforms as transforms

print("Creating custom AraCLIP loader...")

# Based on the araclip source code, we'll create our own version
# that loads the weights properly

try:
    from huggingface_hub import PyTorchModelHubMixin, hf_hub_download
    from transformers import BertConfig, BertModel, AutoTokenizer
    import safetensors.torch
    from open_clip import create_model
    
    print("✅ Imported required modules")
    
    # Copy the classes from araclip but fix the loading issue
    class MultilingualClipEdited(nn.Module):
        def __init__(
            self, transformer_cfg, in_features, out_features, tokenizer_repo_id_or_path
        ):
            super().__init__()
            self.transformer = BertModel(BertConfig(**transformer_cfg))
            self.clip_head = nn.Linear(in_features=in_features, out_features=out_features)
            self.tokenizer = AutoTokenizer.from_pretrained(
                tokenizer_repo_id_or_path,
            )
    
        def forward(self, txt):
            txt_tok = self.tokenizer(txt, padding=True, return_tensors="pt")
            embs = self.transformer(**txt_tok)[0]
            att = txt_tok["attention_mask"]
            embs = (embs * att.unsqueeze(2)).sum(dim=1) / att.sum(dim=1)[:, None]
            return self.clip_head(embs)
    
    
    class CustomAraClip(nn.Module, PyTorchModelHubMixin):
        def __init__(
            self,
            transformer_cfg,
            in_features,
            out_features,
            tokenizer_repo_id_or_path="Arabic-Clip/bert-base-arabertv2-ViT-B-16-SigLIP-512-epoch-155-trained-2M",
        ):
            super().__init__()
            self.text_model = MultilingualClipEdited(
                transformer_cfg,
                in_features,
                out_features,
                tokenizer_repo_id_or_path,
            )
            
            # FIX: Load CLIP model WITH pretrained weights
            # The original uses pretrained_hf=False which causes random initialization
            self.clip_model = create_model("ViT-B-16-SigLIP-512", pretrained="siglip")
            
            self.compose = transforms.Compose(
                [
                    transforms.Resize(
                        (512, 512),
                        interpolation=transforms.InterpolationMode.BICUBIC,
                        antialias=True,
                    ),
                    transforms.Lambda(lambda img: img.convert("RGB")),
                    transforms.ToTensor(),
                    transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
                ]
            )
    
        def language_model(self, queries):
            return np.asarray(self.text_model(queries).detach().to("cpu"))
    
        def embed(self, text: str = None, image: Image.Image = None):
            if text is None and image is None:
                raise ValueError("Please provide either text or image input")
    
            if text is not None and image is not None:
                text_features = self.language_model([text])[0]
                text_features = text_features / np.linalg.norm(text_features)
    
                img_tensor = self.compose(image).unsqueeze(0)
                with torch.no_grad():
                    image_features = self.clip_model.encode_image(img_tensor)
                image_features = image_features.squeeze(0).cpu().numpy()
                image_features = image_features / np.linalg.norm(image_features)
    
                return text_features, image_features
    
            elif text is not None:
                text_features = self.language_model([text])[0]
                return text_features / np.linalg.norm(text_features)
    
            else:
                img_tensor = self.compose(image).unsqueeze(0)
                with torch.no_grad():
                    image_features = self.clip_model.encode_image(img_tensor)
                image_features = image_features.squeeze(0).cpu().numpy()
                return image_features / np.linalg.norm(image_features)
    
    print("\n--- Creating custom model ---")
    
    # First, download and load the config
    config_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="config.json"
    )
    
    import json
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    print(f"Loaded config: in_features={config['in_features']}, out_features={config['out_features']}")
    
    # Create model with config
    model = CustomAraClip(
        transformer_cfg=config['transformer_cfg'],
        in_features=config['in_features'],
        out_features=config['out_features'],
        tokenizer_repo_id_or_path=config['tokenizer_name_or_path']
    )
    
    print("✅ Custom model created")
    
    # Now load the saved weights
    print("\n--- Loading saved weights ---")
    
    model_path = hf_hub_download(
        repo_id="Arabic-Clip/araclip",
        filename="model.safetensors"
    )
    
    state_dict = safetensors.torch.load_file(model_path)
    print(f"Loaded state dict with {len(state_dict)} keys")
    
    # Load weights into model
    # The state dict has keys like 'clip_model.logit_bias', 'text_model.transformer.embeddings.word_embeddings.weight'
    # We need to load them into the appropriate submodules
    
    # Create a new state dict with proper structure
    new_state_dict = {}
    
    for key, value in state_dict.items():
        # Keep the keys as they are - they should match the model structure
        new_state_dict[key] = value
    
    # Load the state dict
    missing_keys, unexpected_keys = model.load_state_dict(new_state_dict, strict=False)
    
    print(f"Missing keys: {len(missing_keys)}")
    print(f"Unexpected keys: {len(unexpected_keys)}")
    
    if missing_keys:
        print("First few missing keys:")
        for key in missing_keys[:5]:
            print(f"  {key}")
    
    if unexpected_keys:
        print("First few unexpected keys:")
        for key in unexpected_keys[:5]:
            print(f"  {key}")
    
    print("✅ Weights loaded")
    
    # Test the model
    print("\n--- Testing the custom model ---")
    
    # Test 1: Text embedding
    print("Test 1: Text embedding")
    arabic_text = "قطة جالسة"  # 'sitting cat'
    
    try:
        text_embedding = model.embed(text=arabic_text)
        print(f"✅ Text embedding generated")
        print(f"  Shape: {text_embedding.shape}")
        print(f"  Type: {type(text_embedding)}")
        print(f"  First 5 values: {text_embedding[:5]}")
    except Exception as e:
        print(f"❌ Text embedding failed: {str(e)}")
        traceback.print_exc()
    
    # Test 2: Image embedding
    print("\nTest 2: Image embedding")
    test_image = Image.new('RGB', (224, 224), color='red')
    
    try:
        image_embedding = model.embed(image=test_image)
        print(f"✅ Image embedding generated")
        print(f"  Shape: {image_embedding.shape}")
        print(f"  Type: {type(image_embedding)}")
        print(f"  First 5 values: {image_embedding[:5]}")
    except Exception as e:
        print(f"❌ Image embedding failed: {str(e)}")
        traceback.print_exc()
    
except Exception as e:
    print(f"❌ Overall failure: {str(e)}")
    traceback.print_exc()