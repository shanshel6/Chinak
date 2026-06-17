import sys
import traceback
from PIL import Image
import numpy as np

print("Testing fixed AraCLIP model loading...")

try:
    from araclip import AraClip
    print("✅ Imported AraClip")
    
    # Try loading the new model
    print("\nTrying to load: Arabic-Clip/Arabert-v2-base-ViT-B-16-SigLIP-512-2M")
    try:
        model = AraClip.from_pretrained("Arabic-Clip/Arabert-v2-base-ViT-B-16-SigLIP-512-2M")
        print("✅ Model loaded successfully!")
        
        # Check model type
        print(f"Model type: {type(model)}")
        
        # Check if it has embed method
        if hasattr(model, 'embed'):
            print("✅ Model has embed method")
            
            # Create a dummy image for testing
            dummy_img = Image.new('RGB', (224, 224), color='red')
            
            # Test embedding
            print("\nTesting embedding generation...")
            try:
                embedding = model.embed(image=dummy_img)
                print("✅ Embedding generated successfully!")
                
                # Convert to numpy array for analysis
                embedding_array = np.array(embedding)
                print(f"Embedding shape: {embedding_array.shape}")
                print(f"Embedding dtype: {embedding_array.dtype}")
                print(f"Embedding min/max: {embedding_array.min():.6f}, {embedding_array.max():.6f}")
                print(f"Embedding mean/std: {embedding_array.mean():.6f}, {embedding_array.std():.6f}")
                
                # Check if it's all zeros (random weights issue)
                if np.allclose(embedding_array, 0):
                    print("⚠️  WARNING: Embedding appears to be all zeros!")
                else:
                    print("✅ Embedding contains non-zero values (good!)")
                    
            except Exception as e:
                print(f"❌ Failed to generate embedding: {str(e)}")
                traceback.print_exc()
        else:
            print("❌ Model does not have embed method")
            
    except Exception as e:
        print(f"❌ Failed to load model: {str(e)}")
        
        # Try the fallback model
        print("\nTrying fallback model: Arabic-Clip/araclip")
        try:
            model = AraClip.from_pretrained("Arabic-Clip/araclip")
            print("✅ Fallback model loaded!")
            
            # Check if it has embed method
            if hasattr(model, 'embed'):
                print("✅ Model has embed method")
                
                # Test with dummy image
                dummy_img = Image.new('RGB', (224, 224), color='red')
                embedding = model.embed(image=dummy_img)
                embedding_array = np.array(embedding)
                print(f"Embedding shape: {embedding_array.shape}")
                
                # Check if it's all zeros
                if np.allclose(embedding_array, 0):
                    print("⚠️  WARNING: Embedding appears to be all zeros (random weights issue)")
                else:
                    print("✅ Embedding contains non-zero values")
            else:
                print("❌ Model does not have embed method")
                
        except Exception as e2:
            print(f"❌ Fallback model also failed: {str(e2)}")
            
except Exception as e:
    print(f"❌ Failed to import AraClip: {str(e)}")
    traceback.print_exc()