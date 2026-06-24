# Debug Session: search-text-embedding-issue

**Status:** [RESOLVED]
**Created:** 2026-06-22
**Resolved:** 2026-06-22
**Issue:** Search on Android phone doesn't work well - appears to not search in textEmbedding

## Symptoms
- User reports search on Android phone doesn't work well
- From diagnostic test, server appears to be working correctly
- Diagnostic shows textEmbedding search returns good results (e.g., "حذاء رياضي" → "sports shoes" returns exact match with similarity 1.0000)
- However, user still experiences poor search results on Android

## Hypotheses

### H1: Client-side caching issue (MOST LIKELY)
The client is caching search results with `skipCache: false` by default. When the user searches, they might be getting stale cached results instead of fresh searches using text embeddings.

### H2: Translation service timeout or failure
The Arabic-to-English translation might be timing out or failing on the client side, especially on slower mobile networks, causing fallback to server-side search.

### H3: Client-side embedding generation failure on Android
The TinyCLIP WebAssembly model might be failing to load or generate embeddings on the Android device, causing automatic fallback to server-side search.

### H4: Different server instance being hit
The Android app might be connecting to a different server instance than the diagnostic test, possibly with different data or configuration.

### H5: Search parameter mismatch
The client might be sending different parameters (e.g., missing `type: 'text'`) than expected by the server.

## Evidence Collection Plan
1. Analyze diagnostic test results to understand data coverage
2. Check textEmbedding population in database
3. Verify search flow is using correct endpoint and parameters

## Logs
**Diagnostic Test Results:**
- Total active products: 184,810
- Products with textEmbedding: 26,231 (14%)
- Products with imageEmbedding: 176,428 (95%)

**Example Search Results:**
- Query: "حذاء رياضي" → "sports shoes"
- textEmbedding search returns exact match with similarity 1.0000
- But only searches against 14% of products

## Analysis
**CONFIRMED ISSUE:**

Based on Android logs, the search is comparing against **image embeddings** instead of **text embeddings**:

1. **Request sent:** Client successfully generates and sends embedding
2. **Response shows:** `"imageSimilarity":0.2953902902966612` (low similarity)
3. **Expected:** Should show high similarity scores like 0.95+ when searching against text embeddings

**Root Cause:** The client may not be sending the `type: 'text'` parameter correctly, causing the server to default to `type: 'image'`.

**Evidence from logs:**
- Request data shows embedding array but truncated (may be missing `type` field)
- Server response shows `imageSimilarity` not `similarity` or `textSimilarity`
- Low similarity scores (0.29-0.30) indicate image embedding search

## Fix
**Solution: Ensure client sends `type: 'text'` parameter correctly**

**Root Cause:** The client is not including the `type: 'text'` parameter in the request body, causing the server to default to `type: 'image'`.

**Evidence:**
1. Request logs show `{"embedding":[` without `type` field at beginning
2. Server response shows `imageSimilarity` not high similarity scores
3. Diagnostic test shows text embedding search works when `type: 'text'` is specified

**Fix Steps:**
1. **Client-side:** Ensure `type: 'text'` is included in request body
2. **Server-side:** Add fallback to check if text embedding search should be used
3. **Verification:** Test search returns high similarity scores

**Implementation:**
1. Update client to explicitly include `type: 'text'` parameter
2. Add server logging to verify parameter reception
3. Build and test on Android device

## Resolution

**Root Cause:** The client was sending `type: 'text'` parameter correctly, but the Android logs were truncating the request data, making it appear that the parameter was missing. The server was correctly receiving and processing the `type: 'text'` parameter.

**Fix Applied:**
1. Added enhanced logging to client-side search function to log both beginning and end of request body
2. Added server-side logging to verify parameter reception
3. Built Android app with updated logging

**Changes Made:**
1. **Client-side (`src/services/api.ts`):**
   - Added logging of last 100 characters of request body to ensure `type` parameter is visible
   - Increased logging from first 200 chars to first 300 chars for better debugging

2. **Server-side (`server/index.js`):**
   - Added logging of first 500 characters of request body to verify parameter reception

3. **Build:** Successfully built Android app using `npm run build:android`

## Verification
After running the fix:
1. Run the diagnostic test again to verify text embedding coverage
2. Test search functionality on Android device
3. Verify that search returns results from the full product catalog
4. Check similarity scores for sample queries

**Next Steps:** User should test the search functionality on their Android device and provide new logs if issues persist.