// seed.js
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const {
  MONGODB_URI,
  MONGO_DB = 'AgriDB',
  MONGO_COLL = 'readings'
} = process.env;

const TOTAL_DOCS = 2000;
const AUTHOR = 'farheen-lab4';   // <- change if needed

function randomReading() {
  return Number((Math.random() * 100).toFixed(2));
}

function randomUnit() {
  const units = ['°C', '%', 'kPa', 'µS/cm'];
  return units[Math.floor(Math.random() * units.length)];
}

function randomSensorId() {
  return `sensor-${Math.floor(Math.random() * 500) + 1}`;
}

function generateDocs(n) {
  return Array.from({ length: n }, () => ({
    sensorId: randomSensorId(),
    reading: randomReading(),
    unit: randomUnit(),
    updatedAt: new Date().toISOString(),
    meta: {
      author: AUTHOR
    }
  }));
}

async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGO_DB);
  const col = db.collection(MONGO_COLL);

  console.log(`Seeding ${TOTAL_DOCS} docs into ${MONGO_DB}.${MONGO_COLL}...`);
  const docs = generateDocs(TOTAL_DOCS);
  const result = await col.insertMany(docs);

  console.log(`✅ Inserted ${result.insertedCount} documents`);
  await client.close();
}

seed().catch(err => {
  console.error('❌ Seed error:', err);
  process.exit(1);
});