import sys
import traceback

print("Testing AraCLIP usage...")

# First, let's check the araclip module structure
try:
    import araclip
    print("✅ Imported araclip")
    
    # List all public attributes
    print("\n=== araclip module structure ===")
    for attr in dir(araclip):
        if not attr.startswith('_'):
            print(f"  {attr}")
    
    # Check the AraClip class
    print("\n=== AraClip class ===")
    if hasattr(araclip, 'AraClip'):
        araclip_class = araclip.AraClip
        print(f"  Class found: {araclip_class}")
        
        # Check class attributes
        print(f"  Module: {araclip_class.__module__}")
        
        # Check if it has from_pretrained
        if hasattr(araclip_class, 'from_pretrained'):
            print(f"  Has from_pretrained: Yes")
            
            # Try to see what it returns
            print(f"\n  Trying from_pretrained with no arguments...")
            try:
                model = araclip_class.from_pretrained()
                print(f"  ✅ Success! Model type: {type(model)}")
            except Exception as e:
                print(f"  ❌ Failed: {str(e)}")
                
            # Try with model name
            print(f"\n  Trying from_pretrained with 'Arabic-Clip/araclip'...")
            try:
                model = araclip_class.from_pretrained("Arabic-Clip/araclip")
                print(f"  ✅ Success! Model type: {type(model)}")
                
                # Check if it has embed method
                if hasattr(model, 'embed'):
                    print(f"  Has embed method: Yes")
                    
                    # Test embed with a simple image
                    from PIL import Image
                    import numpy as np
                    
                    # Create a dummy image
                    dummy_img = Image.new('RGB', (224, 224), color='red')
                    
                    print(f"\n  Testing embed method with dummy image...")
                    try:
                        embedding = model.embed(image=dummy_img)
                        print(f"  ✅ Embedding generated!")
                        print(f"  Embedding shape: {np.array(embedding).shape}")
                        print(f"  Embedding type: {type(embedding)}")
                    except Exception as e:
                        print(f"  ❌ Embed failed: {str(e)}")
                else:
                    print(f"  Has embed method: No")
                    
            except Exception as e:
                print(f"  ❌ Failed: {str(e)}")
                traceback.print_exc()
        else:
            print(f"  Has from_pretrained: No")
            
    else:
        print("  ❌ AraClip class not found!")
        
except Exception as e:
    print(f"❌ Failed to import araclip: {str(e)}")
    traceback.print_exc()

# Let's also check if there are any examples in the package
print("\n\n=== Checking for examples or documentation ===")
try:
    import pkgutil
    import araclip
    
    # List all modules in araclip
    print("Modules in araclip package:")
    for module_info in pkgutil.iter_modules(araclip.__path__):
        print(f"  {module_info.name}")
        
except Exception as e:
    print(f"Error: {str(e)}")