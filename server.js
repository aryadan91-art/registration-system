const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pool = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ==================== Middleware ====================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// محدودیت درخواست
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200
});
app.use('/api/', limiter);

// ==================== توابع کمکی ====================

function normalizeText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[ـ‌]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه');
}

// ==================== کش کردن تنظیمات (برای سرعت) ====================
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_TTL = 5000; // 5 ثانیه

async function getSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
    return settingsCache;
  }
  
  try {
    const result = await pool.query("SELECT key, value FROM settings");
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    settingsCache = settings;
    settingsCacheTime = now;
    return settings;
  } catch (error) {
    console.error('❌ خطا در دریافت تنظیمات:', error);
    return { maxCapacity: '100', deadline: '' };
  }
}

// ==================== API Routes ====================

app.get('/api/status', async (req, res) => {
  try {
    const [settings, countResult] = await Promise.all([
      getSettings(),
      pool.query("SELECT COUNT(*) as count FROM registrations")
    ]);
    
    const count = parseInt(countResult.rows[0].count);
    const maxCapacity = parseInt(settings.maxcapacity) || 100;
    
    let open = true;
    let reason = '';
    if (count >= maxCapacity) {
      open = false;
      reason = 'ظرفیت ثبت‌نام تکمیل شده است.';
    } else if (settings.deadline && settings.deadline !== '') {
      const now = new Date();
      const deadline = new Date(settings.deadline);
      if (now > deadline) {
        open = false;
        reason = 'زمان ثبت‌نام به پایان رسیده است.';
      }
    }

    res.json({
      open,
      reason,
      currentCount: count,
      maxCapacity: maxCapacity,
      deadline: settings.deadline || null
    });
  } catch (error) {
    console.error('❌ Error in /api/status:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, selectedOption, deviceId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

    if (!firstName || !lastName || !selectedOption || !deviceId) {
      return res.status(400).json({ error: 'همه فیلدها الزامی هستند.' });
    }

    const normalizedFirst = normalizeText(firstName);
    const normalizedLast = normalizeText(lastName);

    // اجرای همزمان دو کوئری بررسی
    const [duplicateCheck, deviceCheck] = await Promise.all([
      pool.query(
        "SELECT id FROM registrations WHERE normalizedFirst = $1 AND normalizedLast = $2 LIMIT 1",
        [normalizedFirst, normalizedLast]
      ),
      pool.query(
        "SELECT id FROM registrations WHERE deviceId = $1 LIMIT 1",
        [deviceId]
      )
    ]);

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: 'این نام قبلاً ثبت شده است!' });
    }

    if (deviceCheck.rows.length > 0) {
      return res.status(400).json({ error: 'این دستگاه قبلاً ثبت‌نام کرده است!' });
    }

    // ذخیره در دیتابیس
    await pool.query(
      `INSERT INTO registrations 
       (firstName, lastName, normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [firstName.trim(), lastName.trim(), normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress]
    );

    // پاک کردن کش بعد از ثبت‌نام جدید
    settingsCache = null;
    settingsCacheTime = 0;

    res.json({ success: true, message: '✅ ثبت‌نام با موفقیت انجام شد!' });

  } catch (error) {
    console.error('❌ Error in /api/register:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/admin/registrations', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    const result = await pool.query(
      "SELECT id, firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC LIMIT 1000"
    );

    res.json({ registrations: result.rows });
  } catch (error) {
    console.error('❌ Error in /api/admin/registrations:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { password, maxCapacity, deadline } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    if (maxCapacity && parseInt(maxCapacity) > 0) {
      await pool.query(
        "UPDATE settings SET value = $1 WHERE key = 'maxCapacity'",
        [maxCapacity.toString()]
      );
    }

    if (deadline !== undefined) {
      await pool.query(
        "UPDATE settings SET value = $1 WHERE key = 'deadline'",
        [deadline || '']
      );
    }

    // پاک کردن کش بعد از بروزرسانی
    settingsCache = null;
    settingsCacheTime = 0;

    res.json({ success: true, message: '✅ تنظیمات ذخیره شد!' });
  } catch (error) {
    console.error('❌ خطا در ذخیره تنظیمات:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/admin/export', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    const result = await pool.query(
      "SELECT firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC LIMIT 10000"
    );

    res.json({ registrations: result.rows });
  } catch (error) {
    console.error('❌ Error in /api/admin/export:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

// ==================== تست API ====================
app.get('/api/test', (req, res) => {
  res.json({ status: 'API is working!', time: new Date().toISOString() });
});

// مسیر پیش‌فرض
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== شروع سرور ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ سرور با موفقیت روی پورت ${PORT} اجرا شد!`);
  console.log(`🌐 آدرس: http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('❌ خطای غیرمنتظره:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ خطای غیرمنتظره در Promise:', err);
});
