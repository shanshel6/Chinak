import inspect
import traceback

print("Checking AraClip class initialization...")

try:
    from araclip import AraClip
    print("✅ Imported AraClip")
    
    # Get the __init__ method signature
    init_sig = inspect.signature(AraClip.__init__)
    print(f"\nAraClip.__init__ signature:")
    print(f"  {init_sig}")
    
    # List all parameters
    print(f"\nParameters:")
    for param_name, param in init_sig.parameters.items():
        if param_name != 'self':
            print(f"  {param_name}: {param}")
    
    # Check the from_pretrained method
    print(f"\nChecking from_pretrained method...")
    if hasattr(AraClip, 'from_pretrained'):
        pretrained_sig = inspect.signature(AraClip.from_pretrained)
        print(f"  from_pretrained signature: {pretrained_sig}")
        
        # Check what it returns
        print(f"\n  Trying from_pretrained with 'Arabic-Clip/araclip'...")
        try:
            model = AraClip.from_pretrained("Arabic-Clip/araclip")
            print(f"  ✅ Success!")
            print(f"  Model type: {type(model)}")
            
            # Check model attributes
            print(f"\n  Model attributes:")
            for attr in ['transformer_cfg', 'in_features', 'out_features', 'embed']:
                if hasattr(model, attr):
                    print(f"    {attr}: {getattr(model, attr)}")
                else:
                    print(f"    {attr}: Not found")
                    
        except Exception as e:
            print(f"  ❌ Failed: {str(e)}")
            traceback.print_exc()
    else:
        print("  ❌ from_pretrained method not found")
        
except Exception as e:
    print(f"❌ Failed: {str(e)}")
    traceback.print_exc()