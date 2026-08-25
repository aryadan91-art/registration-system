const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pool = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ==================== کش ====================
let cache = { settings: null, settingsTime: 0, registrations: null, registrationsTime: 0, count: null, countTime: 0 };
const CACHE_TTL = 10000;

function normalizeText(text) {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ').replace(/[ـ‌]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
}

async function getSettings() {
  const now = Date.now();
  if (cache.settings && (now - cache.settingsTime) < CACHE_TTL) return cache.settings;
  try {
    const result = await pool.query("SELECT key, value FROM settings");
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    cache.settings = settings;
    cache.settingsTime = now;
    return settings;
  } catch (error) {
    return { maxCapacity: '60', deadline: '' };
  }
}

// ==================== API ====================

app.get('/api/status', async (req, res) => {
  try {
    const now = Date.now();
    let count;
    if (cache.count !== null && (now - cache.countTime) < CACHE_TTL) {
      count = cache.count;
    } else {
      const countResult = await pool.query("SELECT COUNT(*) as count FROM registrations");
      count = parseInt(countResult.rows[0].count);
      cache.count = count;
      cache.countTime = now;
    }

    const settings = await getSettings();
    const maxCapacity = parseInt(settings.maxcapacity) || 60;
    
    let open = true, reason = '';
    if (count >= maxCapacity) {
      open = false;
      reason = 'ظرفیت ثبت‌نام تکمیل شده است.';
    } else if (settings.deadline && settings.deadline !== '') {
      const nowDate = new Date();
      const deadline = new Date(settings.deadline);
      if (nowDate > deadline) {
        open = false;
        reason = 'زمان ثبت‌نام به پایان رسیده است.';
      }
    }

    res.json({ open, reason, currentCount: count, maxCapacity, deadline: settings.deadline || null });
  } catch (error) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, selectedOption, deviceId } = req.body;
    if (!firstName || !lastName || !selectedOption || !deviceId) {
      return res.status(400).json({ error: 'همه فیلدها الزامی هستند.' });
    }

    const normalizedFirst = normalizeText(firstName);
    const normalizedLast = normalizeText(lastName);

    const [duplicateCheck, deviceCheck] = await Promise.all([
      pool.query("SELECT id FROM registrations WHERE normalizedFirst = $1 AND normalizedLast = $2 LIMIT 1", [normalizedFirst, normalizedLast]),
      pool.query("SELECT id FROM registrations WHERE deviceId = $1 LIMIT 1", [deviceId])
    ]);

    if (duplicateCheck.rows.length > 0) return res.status(400).json({ error: 'این نام قبلاً ثبت شده است!' });
    if (deviceCheck.rows.length > 0) return res.status(400).json({ error: 'این دستگاه قبلاً ثبت‌نام کرده است!' });

    await pool.query(
      `INSERT INTO registrations (firstName, lastName, normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [firstName.trim(), lastName.trim(), normalizedFirst, normalizedLast, selectedOption, deviceId, req.ip || 'unknown']
    );

    cache.count = null;
    cache.registrations = null;
    res.json({ success: true, message: '✅ ثبت‌نام با موفقیت انجام شد!' });
  } catch (error) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.post('/api/admin/registrations', async (req, res) => {
  try {
    if (req.body.password !== '1234') return res.status(401).json({ error: 'رمز عبور اشتباه است!' });

    const now = Date.now();
    let registrations;
    if (cache.registrations && (now - cache.registrationsTime) < CACHE_TTL) {
      registrations = cache.registrations;
    } else {
      const result = await pool.query("SELECT id, firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC LIMIT 100");
      registrations = result.rows;
      cache.registrations = registrations;
      cache.registrationsTime = now;
    }

    res.json({ registrations });
  } catch (error) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { password, maxCapacity, deadline } = req.body;
    if (password !== '1234') return res.status(401).json({ error: 'رمز عبور اشتباه است!' });

    if (maxCapacity && parseInt(maxCapacity) > 0) {
      await pool.query("UPDATE settings SET value = $1 WHERE key = 'maxCapacity'", [maxCapacity.toString()]);
    }
    if (deadline !== undefined) {
      await pool.query("UPDATE settings SET value = $1 WHERE key = 'deadline'", [deadline || '']);
    }

    cache = { settings: null, settingsTime: 0, registrations: null, registrationsTime: 0, count: null, countTime: 0 };
    res.json({ success: true, message: '✅ تنظیمات ذخیره شد!' });
  } catch (error) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.post('/api/admin/export', async (req, res) => {
  try {
    if (req.body.password !== '1234') return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    const result = await pool.query("SELECT firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC LIMIT 1000");
    res.json({ registrations: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

app.get('/api/test', (req, res) => res.json({ status: 'API is working!', time: new Date().toISOString() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ سرور فوق‌سریع روی پورت ${PORT} اجرا شد!`);
});

process.on('uncaughtException', (err) => console.error('❌ خطا:', err));
process.on('unhandledRejection', (err) => console.error('❌ خطا:', err));
