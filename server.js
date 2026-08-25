const express = require('express');
const cors = require('cors');
const db = require('./database');
const path = require('path');

const app = express();

// ==================== Middleware ====================
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

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
    const settings = await db.getSettings();
    cache.settings = settings;
    cache.settingsTime = now;
    return settings;
  } catch (error) {
    console.error('❌ Error getting settings:', error);
    return { maxCapacity: '60', deadline: '' };
  }
}

// ==================== API Routes ====================

app.get('/api/status', async (req, res) => {
  try {
    const now = Date.now();
    let count;
    if (cache.count !== null && (now - cache.countTime) < CACHE_TTL) {
      count = cache.count;
    } else {
      count = await db.getCount();
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
    console.error('❌ Error in /api/status:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
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
      db.checkDuplicate(normalizedFirst, normalizedLast),
      db.checkDevice(deviceId)
    ]);

    if (duplicateCheck) return res.status(400).json({ error: 'این نام قبلاً ثبت شده است!' });
    if (deviceCheck) return res.status(400).json({ error: 'این دستگاه قبلاً ثبت‌نام کرده است!' });

    await db.addRegistration({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      normalizedFirst,
      normalizedLast,
      selectedOption,
      deviceId,
      ipAddress: req.ip || 'unknown'
    });

    cache.count = null;
    cache.registrations = null;
    res.json({ success: true, message: '✅ ثبت‌نام با موفقیت انجام شد!' });
  } catch (error) {
    console.error('❌ Error in /api/register:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
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
      registrations = await db.getAllRegistrations();
      cache.registrations = registrations;
      cache.registrationsTime = now;
    }

    res.json({ registrations });
  } catch (error) {
    console.error('❌ Error in /api/admin/registrations:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { password, maxCapacity, deadline } = req.body;
    if (password !== '1234') return res.status(401).json({ error: 'رمز عبور اشتباه است!' });

    if (maxCapacity && parseInt(maxCapacity) > 0) {
      await db.updateSettings('maxCapacity', maxCapacity.toString());
    }
    if (deadline !== undefined) {
      await db.updateSettings('deadline', deadline || '');
    }

    cache = { settings: null, settingsTime: 0, registrations: null, registrationsTime: 0, count: null, countTime: 0 };
    res.json({ success: true, message: '✅ تنظیمات ذخیره شد!' });
  } catch (error) {
    console.error('❌ Error in /api/admin/settings:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.post('/api/admin/export', async (req, res) => {
  try {
    if (req.body.password !== '1234') return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    const registrations = await db.getAllRegistrations();
    res.json({ registrations });
  } catch (error) {
    console.error('❌ Error in /api/admin/export:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

app.get('/api/test', (req, res) => res.json({ status: 'API is working!', time: new Date().toISOString() }));

// ==================== مسیر پیش‌فرض ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== برای Vercel ====================
module.exports = app;
