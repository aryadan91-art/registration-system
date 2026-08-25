const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:LrF3Tj5tvZnUHuEE@db.zdfizkafdmwppjdakahb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 2000,
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        firstName TEXT NOT NULL,
        lastName TEXT NOT NULL,
        normalizedFirst TEXT NOT NULL,
        normalizedLast TEXT NOT NULL,
        selectedOption TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        ipAddress TEXT,
        submittedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_normalized_names ON registrations (normalizedFirst, normalizedLast)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_id ON registrations (deviceId)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_submitted_at ON registrations (submittedAt DESC)`);

    const res = await pool.query("SELECT * FROM settings WHERE key = 'maxCapacity'");
    if (res.rows.length === 0) {
      await pool.query("INSERT INTO settings (key, value) VALUES ('maxCapacity', '60')");
      await pool.query("INSERT INTO settings (key, value) VALUES ('deadline', '')");
    }
    
    console.log('✅ Supabase متصل شد!');
  } catch (error) {
    console.error('❌ خطا در اتصال:', error.message);
  }
}

initDB();
module.exports = pool;
