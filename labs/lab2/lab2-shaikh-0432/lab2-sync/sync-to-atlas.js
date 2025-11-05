// sync-to-atlas.js
const fs = require("fs");
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;          // 1) connect via env var
const inputFile = process.argv[2] || "FarmSensorsDB-mongo-payload.json";
const DB_NAME = "Lab2";
const COLL_NAME = "Agriculture";

// 2) read payload
const raw = fs.readFileSync(inputFile, "utf8");
const payload = JSON.parse(raw);

// 3) embed same metadata + UTC normalize, strictly first 10 (map/filter/reduce only)
const authorName = payload?.metadata?.author;

const first10 = (payload.data || [])
  .filter((_, i) => i < 10) // exactly the first 10
  .map(d => Object.assign({}, d, {
    timestamp: new Date(d.timestamp).toISOString(),      // UTC normalize
    metadata: Object.assign({}, payload.metadata)        // embed same metadata
  }))
  .reduce((acc, x) => acc.concat([x]), []);              // rebuild via reduce

// 4) upsert build (array created with map; no loops)
const ops = first10.map(doc => ({
  replaceOne: {
    filter: { id: doc.id, "metadata.author": authorName },
    replacement: doc,
    upsert: true
  }
}));

(async () => {
  if (!uri) { console.error("Missing MONGODB_URI"); process.exit(1); }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    const coll = client.db(DB_NAME).collection(COLL_NAME);

    // Hygiene: remove any extra docs for this author where id > 10
    await coll.deleteMany({ "metadata.author": authorName, id: { $gt: 10 } });

    // 5) insert/upsert exactly these 10
    const result = await coll.bulkWrite(ops, { ordered: true });

    // quick verification in console
    const count = await coll.countDocuments({ "metadata.author": authorName });
    console.log({ upserted: result.upsertedCount, modified: result.modifiedCount, count });
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await client.close();
  }
})();