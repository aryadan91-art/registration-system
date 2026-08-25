const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// اتصال به دیتابیس
const db = new sqlite3.Database(path.join(__dirname, 'registration.db'));

// ایجاد جداول
db.serialize(() => {
  // جدول ثبت‌نام‌ها
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      normalizedFirst TEXT NOT NULL,
      normalizedLast TEXT NOT NULL,
      selectedOption TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      ipAddress TEXT,
      submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // جدول تنظیمات
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // تنظیمات پیش‌فرض (اگر وجود نداشت)
  db.get("SELECT * FROM settings WHERE key = 'maxCapacity'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO settings (key, value) VALUES ('maxCapacity', '100')");
      db.run("INSERT INTO settings (key, value) VALUES ('deadline', '')");
    }
  });
});

module.exports = db;