# Local Translation Server Setup

## Installation

1. Install dependencies in the server folder:
```bash
cd server
npm install @huggingface/transformers express cors
```

2. Start the translation server:
```bash
# Method 1: Using batch file
start-translation-server.bat

# Method 2: Using node
node translation-server.js
```

3. The server will start on port 5002

## API Endpoints

**Health Check:**
```
GET http://localhost:5002/health
```

**Translate:**
```
POST http://localhost:5002/api/translate
Content-Type: application/json

{
  "text": "你好世界",
  "from": "zh",
  "to": "ar"
}
```

## Language Codes
- Chinese: `zh` or `chinese`
- Arabic: `ar` or `arabic`  
- English: `en` or `english`

## Integration

Update your existing API to use the local translation server by changing the translation endpoint from SiliconFlow to `http://localhost:5002/api/translate`.
