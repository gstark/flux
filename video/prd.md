# KVault — A Bun Key-Value Store

A minimal HTTP key-value store built with Bun. No dependencies.

## Requirements

### HTTP Server
- Bun.serve() on port 3000
- GET /health returns {"ok": true, "uptime": <seconds>}

### REST API
- PUT /kv/:key — store a JSON value (request body)
- GET /kv/:key — retrieve a value (404 if missing)
- DELETE /kv/:key — remove a key (404 if missing)
- GET /kv — list all keys with values

### Web Dashboard
- GET / serves an HTML page listing all stored keys and values
- Auto-refreshes every 5 seconds
- Minimal inline CSS (no external dependencies)

### Persistence
- Write the store to a JSON file on every mutation
- Load from file on startup (empty store if file missing)

### Input Validation
- Reject PUT with no body (400)
- Reject keys longer than 256 characters (400)
- All responses must set Content-Type: application/json (API) or text/html (dashboard)
