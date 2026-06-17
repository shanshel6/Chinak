
import sys
import json
import traceback

try:
    from araclip import AraClip
    import numpy as np
except ImportError as e:
    print(json.dumps({"error": f"Failed to import AraCLIP: {str(e)}"}))
    sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No text provided"}))
        sys.exit(1)

    text = sys.argv[1]

    try:
        # Load model
        try:
            model = AraClip.from_pretrained()
        except Exception:
            model = AraClip.from_pretrained("Arabic-Clip/araclip")

        # Embed text
        text_embedding = model.embed(text=text)
        
        if isinstance(text_embedding, np.ndarray):
            embedding_list = text_embedding.tolist()
        else:
            embedding_list = list(text_embedding)

        # Ensure 768 dimensions
        if len(embedding_list) != 768:
            raise Exception(f"Unexpected embedding length: {len(embedding_list)}, expected 768")

        # Normalize
        norm = np.linalg.norm(embedding_list)
        if norm > 0:
            embedding_list = (np.array(embedding_list) / norm).tolist()

        print(json.dumps({"embedding": embedding_list}))
    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    main()
