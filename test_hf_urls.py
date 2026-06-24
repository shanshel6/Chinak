import urllib.request

urls = [
    ('vision_model_quantized.onnx', 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx'),
    ('preprocessor_config.json', 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/preprocessor_config.json'),
    ('config.json', 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/config.json'),
]

for name, url in urls:
    print(f"\n=== {name} ===")
    print(f"URL: {url}")
    try:
        req = urllib.request.Request(url, method='HEAD')
        req.add_header('Origin', 'http://localhost')
        r = urllib.request.urlopen(req, timeout=10)
        print(f"HEAD: status={r.status}")
        for k, v in r.headers.items():
            if 'access' in k.lower() or 'content' in k.lower() or 'accept' in k.lower() or 'cors' in k.lower():
                print(f"  {k}: {v}")
        print(f"  Content-Length: {r.headers.get('Content-Length', 'N/A')}")
        print(f"  Content-Type: {r.headers.get('Content-Type', 'N/A')}")
    except Exception as e:
        print(f"HEAD failed: {e}")
    
    # Try GET with Range (0-0)
    try:
        req2 = urllib.request.Request(url)
        req2.add_header('Origin', 'http://localhost')
        req2.add_header('Range', 'bytes=0-0')
        r2 = urllib.request.urlopen(req2, timeout=10)
        print(f"GET Range 0-0: status={r2.status}")
        for k, v in r2.headers.items():
            if 'access' in k.lower() or 'content' in k.lower() or 'accept' in k.lower() or 'cors' in k.lower():
                print(f"  {k}: {v}")
        print(f"  Content-Length: {r2.headers.get('Content-Length', 'N/A')}")
        body = r2.read()
        print(f"  Body length: {len(body)}")
    except Exception as e:
        print(f"GET Range 0-0 failed: {e}")