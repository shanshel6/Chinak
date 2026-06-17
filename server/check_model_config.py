import requests
import json

# Download the config file
url = 'https://huggingface.co/Arabic-Clip/araclip/raw/main/config.json'
response = requests.get(url)
config = response.json()

print('Config file contents:')
print(json.dumps(config, indent=2))

# Check key information
print("\n=== Key Model Information ===")
print(f"in_features: {config.get('in_features')}")
print(f"out_features: {config.get('out_features')}")
print(f"tokenizer_name_or_path: {config.get('tokenizer_name_or_path')}")

# Check transformer config
transformer_cfg = config.get('transformer_cfg', {})
print(f"\n=== Transformer Config ===")
print(f"architectures: {transformer_cfg.get('architectures')}")
print(f"model_type: {transformer_cfg.get('model_type')}")
print(f"hidden_size: {transformer_cfg.get('hidden_size')}")
print(f"num_hidden_layers: {transformer_cfg.get('num_hidden_layers')}")
print(f"num_attention_heads: {transformer_cfg.get('num_attention_heads')}")

# Check if this is actually a BERT model
if transformer_cfg.get('architectures') == ['BertModel']:
    print("\n⚠️  This appears to be a BERT model, not a CLIP model!")
    print("The AraCLIP package might be expecting a different architecture.")