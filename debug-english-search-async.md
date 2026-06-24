# Debug: English Search Not Returning Expected Results

## Status: [OPEN]

## Symptoms
- User searches "High-Pressure Drain Unclogging Tool One Shot" in English in Android app
- The product (id 277401) exists in DB with matching English name and `textEmbedding`
- Server-side test (`test_search_flow.mjs`) returns product 277401 at position #1 with 100% similarity
- Android app does NOT return the product as expected

## Hypotheses

### H1: Request never reaches the server
- The client may not be sending the request to `/api/products/search-by-photo` at all
- Could be failing silently due to a CORS / network issue in Android

### H2: Server receives request but with empty/wrong query
- Client may be sending empty `search` parameter
- Client may be URL-encoding incorrectly
- Client may be sending Arabic instead of English

### H3: Server receives request but filters out valid results
- Server's `search-by-photo` endpoint may have a `status = 'PUBLISHED'` or `isActive = true` filter that excludes the product
- Product 277401 may not match these filters

### H4: Server returns results but client filters them out
- The client may be applying a post-filter that excludes product 277401
- For example: price filter, condition filter, category filter

### H5: Response is not received/parsed correctly
- Server returns valid response but Android app fails to parse it
- BigInt or other serialization issue in the response

## Reproduction Steps
1. Open Android app on device/emulator
2. Search for "High-Pressure Drain Unclogging Tool One Shot" in English
3. Observe search results - product 277401 should be #1

## Investigation Plan
1. Start Debug Server to collect logs from Android device
2. Add instrumentation in `src/services/api.ts` `searchProducts` function
3. Add instrumentation in server endpoint `/api/products/search-by-photo`
4. Run search in Android app
5. Analyze logs to determine which hypothesis is correct

## Evidence Log
(empty - to be filled with runtime evidence)

## Instrumentation Added
- Client: `src/services/api.ts` - `searchProducts` function reports via `DEBUG_SEARCH_REPORTER`:
  - `search-entry` - query received
  - `after-translation-skip` - confirms translation was skipped
  - `client-embedding-generated` - client-side embedding (skipped due to `useServerFallback = true`)
  - `client-embedding-failed` - if client embed throws
  - `using-server-fallback` - server fallback path entered
  - `sending-server-fallback-request` - actual URL being sent
  - `server-fallback-response` - response received, includes product IDs
  - `server-fallback-failed` - if request fails
- Server: `server/index.js` - `/api/products/search-by-photo`:
  - `search-by-photo-entry` - confirms server received request
  - `search-by-photo-embedding-generated` - server-generated embedding details
  - `search-by-photo-final` - critical: shows whether 277401 is in matches and final result
  - `search-by-photo-error` - if server error occurs

## Build & Run Instructions
1. Backend: `node server/index.js` (port 5001)
2. Run app: Android Studio → Run
3. Search: "High-Pressure Drain Unclogging Tool One Shot"
4. View logs: `curl http://127.0.0.1:7890/logs | python -m json.tool`
