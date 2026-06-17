import numpy as np
from PIL import Image
import io
import requests

print('Testing AraCLIP embedding generation...')

try:
    from araclip import AraClip
    print('✅ Imported araclip')
    
    # Load model
    model = AraClip.from_pretrained('Arabic-Clip/araclip')
    print('✅ Model loaded')
    
    # Test 1: Text embedding
    print('\n--- Test 1: Text embedding ---')
    arabic_text = 'قطة جالسة'  # 'sitting cat'
    print(f'Text: "{arabic_text}"')
    
    try:
        text_embedding = model.embed(text=arabic_text)
        print(f'✅ Text embedding generated')
        print(f'  Shape: {text_embedding.shape}')
        print(f'  Type: {type(text_embedding)}')
        print(f'  First 5 values: {text_embedding[:5]}')
    except Exception as e:
        print(f'❌ Text embedding failed: {str(e)}')
    
    # Test 2: Image embedding (using a simple test image)
    print('\n--- Test 2: Image embedding ---')
    print('Creating a simple test image...')
    
    # Create a simple red image
    test_image = Image.new('RGB', (224, 224), color='red')
    
    try:
        image_embedding = model.embed(image=test_image)
        print(f'✅ Image embedding generated')
        print(f'  Shape: {image_embedding.shape}')
        print(f'  Type: {type(image_embedding)}')
        print(f'  First 5 values: {image_embedding[:5]}')
    except Exception as e:
        print(f'❌ Image embedding failed: {str(e)}')
    
    # Test 3: Compare embeddings
    print('\n--- Test 3: Similarity test ---')
    if 'text_embedding' in locals() and 'image_embedding' in locals():
        try:
            similarity = np.dot(text_embedding, image_embedding)
            print(f'Similarity between "{arabic_text}" and red image: {similarity:.4f}')
        except Exception as e:
            print(f'❌ Similarity calculation failed: {str(e)}')
    
except Exception as e:
    print(f'❌ Failed: {str(e)}')
    import traceback
    traceback.print_exc()