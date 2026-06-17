import sys
import traceback

print("Simple AraCLIP test...")

try:
    from araclip import AraClip
    print("✅ Imported AraClip")
    
    # Try to load the model
    print("Loading model...")
    model = AraClip.from_pretrained("Arabic-Clip/araclip")
    print("✅ Model loaded")
    
    # Check the model structure
    print("\nModel structure:")
    print(f"  Type: {type(model)}")
    print(f"  Has clip_model: {hasattr(model, 'clip_model')}")
    print(f"  Has text_model: {hasattr(model, 'text_model')}")
    
    if hasattr(model, 'clip_model'):
        clip_model = model.clip_model
        print(f"  clip_model type: {type(clip_model)}")
        
        # Check if it has pretrained weights
        print(f"  clip_model parameters: {sum(p.numel() for p in clip_model.parameters())}")
        
        # Check the first parameter to see if it's random
        for name, param in clip_model.named_parameters():
            print(f"  First parameter: {name}, shape: {param.shape}, mean: {param.mean().item():.6f}")
            break
    
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()