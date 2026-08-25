const { Pool } = require('pg');

// اتصال به دیتابیس PostgreSQL
const pool = new Pool({
  connectionString: 'postgresql://registration_db_hrrz_user:Sd6AfFMxlow3mkhgaSVGeA3RL240AdQw@dpg-da6qnaifngtc73c0ijig-a/registration_db_hrrz',
  ssl: {
    rejectUnauthorized: false
  }
});

// ایجاد جداول
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

    const res = await pool.query("SELECT * FROM settings WHERE key = 'maxCapacity'");
    if (res.rows.length === 0) {
      await pool.query("INSERT INTO settings (key, value) VALUES ('maxCapacity', '100')");
      await pool.query("INSERT INTO settings (key, value) VALUES ('deadline', '')");
    }
    
    console.log('✅ دیتابیس PostgreSQL آماده است!');
  } catch (error) {
    console.error('❌ خطا در راه‌اندازی دیتابیس:', error);
  }
}

initDB();

module.exports = pool;
