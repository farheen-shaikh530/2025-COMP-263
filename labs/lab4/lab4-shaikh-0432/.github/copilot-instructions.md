This repository is a small Node.js demo showing several Redis caching patterns (cache-aside, read-through, write-through, write-behind, TTL).

Quick context
- Entry point: `src/server.js` (Express app).  The app demonstrates 5 caching strategies using MongoDB + Redis.
- Scripts: defined in `package.json`: `npm start` (production), `npm run dev` (NODE_ENV=development). Both run `node src/server.js`.
- Dependencies: `ioredis` for Redis, `mongodb` native driver for MongoDB, `express`, `morgan`, and `dotenv` for env vars.

What to know when editing or generating code
- The server expects these environment variables (see top of `src/server.js`):
  - `MONGODB_URI` (required)
  - `REDIS_URL` (defaults to `redis://127.0.0.1:6379`)
  - `PORT` (defaults to 3000)
  - `MONGO_DB` and `MONGO_COLL` (defaults: `AgriDB`, `readings`)
  - `DEFAULT_TTL_SECONDS` (string; default `60`)

- Connection pattern: `init()` builds a `MongoClient` and an `ioredis` Redis client and assigns module-scoped variables (`mongo`, `db`, `readings`, `redis`). Keep changes that preserve these shared variables or adjust all usages accordingly.

- Cache key format: produced by `key(id)` -> `readings:${id}`. Use this exact pattern when reading/writing cache to avoid mismatches.

Endpoints to reference (use exact paths when writing tests or examples)
- GET /v1/cache-aside/readings/:id  → cache-aside lazy-loading
- GET /v1/read-through/readings/:id → demo read-through
- POST /v1/write-through/readings → synchronous write to DB + cache
- POST /v1/write-behind/readings → writes to cache and flushes to DB asynchronously (demo; not durable)
- GET /v1/ttl/readings/:id → cache with TTL set from DEFAULT_TTL_SECONDS
- GET /health → returns Redis PING and Mongo ping (useful for smoke tests)

Project-specific patterns and gotchas
- write-behind endpoint uses a temporary ObjectId for the cached entry and later replaces it with the persisted ID. If you modify the persistence flow, keep the same behavior or update the log messages/endpoints consumers rely on.
- TTL handling: `setCacheJSON(k, value, ttlSec)` passes `EX <seconds>` only when ttl is provided; otherwise entries are stored without TTL. Tests relying on TTL should call the `/v1/ttl` path.
- JSON storage: values are stored as JSON strings in Redis (stringified entire Mongo document). Use `getCacheJSON` and `setCacheJSON` helpers for consistent encoding/decoding.

Developer workflows (commands to run)
- Start locally (requires MongoDB and Redis reachable from env or defaults):
  - npm run dev
  - npm start

- Health check (after start): GET http://localhost:3000/health → expects status 'ok'

Testing / debugging tips for AI agents
- To write unit tests, mock `ioredis` and `mongodb` clients; note that `src/server.js` creates clients at runtime in `init()` — consider refactoring to allow dependency injection for easier testing, or run tests against a test containerized Redis/Mongo.
- When changing cache key naming or serialization, update both `key()` and `getCacheJSON`/`setCacheJSON` helpers together.
- For performance experiments, `/bench/:id` demonstrates a cold vs warm comparison; it relies on `redis.del(k)` and the cache-aside endpoint.

Files to open first when editing
- `src/server.js` — main logic and canonical examples of patterns
- `package.json` — scripts and dependencies

If merging into an existing instructions file
- Preserve any existing troubleshooting steps or CI commands. Replace server-specific sections with the up-to-date list above (entry point, env vars, endpoints, and key helpers).

If anything in this file is unclear or you want more examples (sample curl commands, small tests, or refactor suggestions to improve testability), tell me which area to expand.
