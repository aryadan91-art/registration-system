const { Pool } = require('pg');

// اتصال به دیتابیس PostgreSQL
const pool = new Pool({
  connectionString: 'postgresql://registration_db_hrrz_user:Sd6AfFMxlow3mkhgaSVGeA3RL240AdQw@dpg-da6qnaifngtc73c0ijig-a.virginia-postgres.render.com/registration_db_hrrz',
  ssl: {
    rejectUnauthorized: false
  },
  // تنظیمات بهینه برای سرعت
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ایجاد جداول و ایندکس‌ها
async function initDB() {
  try {
    // جدول registrations
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

    // جدول settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // ایندکس‌ها برای سرعت
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_normalized_names 
      ON registrations (normalizedFirst, normalizedLast)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_device_id 
      ON registrations (deviceId)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_submitted_at 
      ON registrations (submittedAt DESC)
    `);

    // تنظیمات پیش‌فرض
    const res = await pool.query("SELECT * FROM settings WHERE key = 'maxCapacity'");
    if (res.rows.length === 0) {
      await pool.query("INSERT INTO settings (key, value) VALUES ('maxCapacity', '100')");
      await pool.query("INSERT INTO settings (key, value) VALUES ('deadline', '')");
    }
    
    console.log('✅ دیتابیس PostgreSQL با ایندکس آماده است!');
  } catch (error) {
    console.error('❌ خطا در راه‌اندازی دیتابیس:', error);
  }
}

initDB();

module.exports = pool;
