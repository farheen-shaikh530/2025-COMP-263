// src/server.js
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import { MongoClient, ObjectId } from 'mongodb';
import Redis from 'ioredis';


const app = express();
app.use(express.json());
app.use(morgan('dev'));

const {
  PORT = 3000,
  MONGODB_URI,
  REDIS_URL = 'redis://127.0.0.1:6379',
  MONGO_DB = 'AgriDB',
  MONGO_COLL = 'readings',
  DEFAULT_TTL_SECONDS = '60',
} = process.env;

let mongo, db, readings, redis;

// --- Connect to MongoDB + Redis ---
async function init() {
  try {
    mongo = new MongoClient(MONGODB_URI);
    await mongo.connect();
    db = mongo.db(MONGO_DB);
    readings = db.collection(MONGO_COLL);

    redis = new Redis(REDIS_URL);

    // Ensure both connections are healthy:
    const pong = await redis.ping();

    console.log('✅ MongoDB connected:', MONGO_DB, '/', MONGO_COLL);
    console.log('✅ Redis connected (PING ->)', pong);

  } catch (err) {
    console.error('❌ Init error:', err);
    process.exit(1);
  }
}

const key = (id) => `readings:${id}`;

// --- Utilities ---
async function getFromMongo(id) {
  let doc = null;
  try {
    doc = await readings.findOne({ _id: new ObjectId(id) });
  } catch {
    doc = await readings.findOne({ sensorId: id });
  }
  return doc;
}

async function setCacheJSON(k, value, ttlSec = null) {
  const payload = JSON.stringify(value);
  if (ttlSec) {
    await redis.set(k, payload, 'EX', Number(ttlSec));
  } else {
    await redis.set(k, payload);
  }
}
async function getCacheJSON(k) {
  const raw = await redis.get(k);
  return raw ? JSON.parse(raw) : null;
}

// -------------------
// 1) Cache-Aside (lazy loading)
// GET: try cache; on miss -> DB -> set cache -> return
// -------------------
app.get('/v1/cache-aside/readings/:id', async (req, res) => {
  try {
    const k = key(req.params.id);
    let data = await getCacheJSON(k);
    const warm = !!data;
    if (!data) {
      data = await getFromMongo(req.params.id);
      if (data) await setCacheJSON(k, data);
    }
    return res.json({ strategy: 'cache-aside', warm, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// -------------------
// 2) Read-Through (app behaves like cache client but “always read via cache layer”)
// For demo parity, behaves similar to cache-aside; in production this is inside the cache provider.
// -------------------
app.get('/v1/read-through/readings/:id', async (req, res) => {
  try {
    const k = key(req.params.id);
    let data = await getCacheJSON(k);
    const warm = !!data;
    if (!data) {
      // “cache provider” fetches from DB on miss:
      data = await getFromMongo(req.params.id);
      if (data) await setCacheJSON(k, data);
    }
    return res.json({ strategy: 'read-through', warm, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// -------------------
// 3) Write-Through (write to DB AND cache synchronously)
// -------------------
app.post('/v1/write-through/readings', async (req, res) => {
  try {
    const body = req.body || {};
    const { insertedId } = await readings.insertOne(body);
    const doc = { _id: insertedId, ...body };
    await setCacheJSON(key(insertedId.toString()), doc);
    return res.status(201).json({ strategy: 'write-through', doc });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// -------------------
// 4) Write-Behind (write to cache first, persist to DB asynchronously)
// WARNING: demo-only; if process crashes before flush, data may be lost.
// -------------------
app.post('/v1/write-behind/readings', async (req, res) => {
  try {
    const tempId = new ObjectId(); // provisional id for cache key
    const doc = { _id: tempId, ...(req.body || {}) };
    await setCacheJSON(key(tempId.toString()), doc);
    // async “flush” to DB
    setTimeout(async () => {
      try {
        const { _id, ...rest } = doc;
        const { insertedId } = await readings.insertOne(rest);
        // replace cache key with real DB id if you want:
        await redis.del(key(tempId.toString()));
        const persisted = { _id: insertedId, ...rest };
        await setCacheJSON(key(insertedId.toString()), persisted);
        console.log('🗄️ write-behind persisted:', insertedId.toString());
      } catch (err) {
        console.error('write-behind flush failed:', err.message);
      }
    }, 100); // small delay to simulate async pipeline/queue
    return res.status(202).json({ strategy: 'write-behind', queued: true, doc });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// -------------------
// 5) Expiration-Based (TTL) – cache entries expire after N seconds
// -------------------
app.get('/v1/ttl/readings/:id', async (req, res) => {
  try {
    const ttl = Number(DEFAULT_TTL_SECONDS);
    const k = key(req.params.id);
    let data = await getCacheJSON(k);
    const warm = !!data;
    if (!data) {
      data = await getFromMongo(req.params.id);
      if (data) await setCacheJSON(k, data, ttl);
    }
    const ttlLeft = await redis.ttl(k);
    return res.json({ strategy: 'ttl', warm, ttlLeftSeconds: ttlLeft, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Simple health check for your screenshot ---
app.get('/health', async (_req, res) => {
  try {
    const pong = await redis.ping();
    // run a trivial Mongo command
    await db.command({ ping: 1 });
    return res.json({
      status: 'ok',
      redis: pong,
      mongoDb: MONGO_DB,
      collection: MONGO_COLL,
      message: 'Connected to Redis and MongoDB',
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', error: e.message });
  }
});

// --- Optional: micro-benchmark utility for cold vs warm ---
app.get('/bench/:id', async (req, res) => {
  const id = req.params.id;
  const k = key(id);
  const t = () => Number(process.hrtime.bigint()) / 1e6; // ms

  try {
    await redis.del(k); // ensure cold
    const t0 = t();
    await app.inject?.get?.(`/v1/cache-aside/readings/${id}`); // if using fastify; else we’ll inline:
    let data = await getCacheJSON(k);
    if (!data) { // cold miss path
      const fromDb = await getFromMongo(id);
      if (fromDb) await setCacheJSON(k, fromDb);
    }
    const t1 = t();
    // warm
    await getCacheJSON(k);
    const t2 = t();
    return res.json({
      id,
      cold_ms: +(t1 - t0).toFixed(3),
      warm_ms: +(t2 - t1).toFixed(3),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

init().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
    console.log('📸 For your screenshot, open: GET /health');
  });
});