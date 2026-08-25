const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Middleware ====================
app.use(helmet()); // امنیت
app.use(cors()); // اجازه درخواست از دامنه‌های دیگر
app.use(express.json());
app.use(express.static('public'));

// محدودیت درخواست (Rate Limiting)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقیقه
  max: 100 // حداکثر 100 درخواست
});
app.use('/api/', limiter);

// ==================== توابع کمکی ====================

// نرمال‌سازی متن (ضدتقلب)
function normalizeText(text) {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[ـ‌]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه');
}

// دریافت تنظیمات
function getSettings() {
  return new Promise((resolve, reject) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
      if (err) reject(err);
      const settings = {};
      rows.forEach(row => {
        settings[row.key] = row.value;
      });
      resolve(settings);
    });
  });
}

// بررسی باز بودن ثبت‌نام
async function isRegistrationOpen() {
  const settings = await getSettings();
  const maxCapacity = parseInt(settings.maxCapacity) || 100;
  
  // بررسی ظرفیت
  const count = await new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM registrations", (err, row) => {
      if (err) reject(err);
      resolve(row.count);
    });
  });

  if (count >= maxCapacity) {
    return { open: false, reason: 'ظرفیت ثبت‌نام تکمیل شده است.' };
  }

  // بررسی تاریخ انقضا
  if (settings.deadline && settings.deadline !== '') {
    const now = new Date();
    const deadline = new Date(settings.deadline);
    if (now > deadline) {
      return { open: false, reason: 'زمان ثبت‌نام به پایان رسیده است.' };
    }
  }

  return { open: true };
}

// ==================== API Routes ====================

// 1. وضعیت سیستم
app.get('/api/status', async (req, res) => {
  try {
    const status = await isRegistrationOpen();
    const settings = await getSettings();
    const count = await new Promise((resolve, reject) => {
      db.get("SELECT COUNT(*) as count FROM registrations", (err, row) => {
        if (err) reject(err);
        resolve(row.count);
      });
    });

    res.json({
      ...status,
      currentCount: count,
      maxCapacity: parseInt(settings.maxCapacity) || 100,
      deadline: settings.deadline || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ثبت‌نام جدید
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, selectedOption, deviceId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // اعتبارسنجی
    if (!firstName || !lastName || !selectedOption || !deviceId) {
      return res.status(400).json({ error: 'همه فیلدها الزامی هستند.' });
    }

    // بررسی باز بودن ثبت‌نام
    const status = await isRegistrationOpen();
    if (!status.open) {
      return res.status(400).json({ error: status.reason });
    }

    const normalizedFirst = normalizeText(firstName);
    const normalizedLast = normalizeText(lastName);

    // بررسی تکراری بودن (با نرمال‌سازی)
    const duplicate = await new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM registrations WHERE normalizedFirst = ? AND normalizedLast = ?",
        [normalizedFirst, normalizedLast],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (duplicate) {
      return res.status(400).json({ error: 'این نام قبلاً ثبت شده است!' });
    }

    // بررسی دستگاه
    const deviceUsed = await new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM registrations WHERE deviceId = ?",
        [deviceId],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (deviceUsed) {
      return res.status(400).json({ error: 'این دستگاه قبلاً ثبت‌نام کرده است!' });
    }

    // ذخیره در دیتابیس
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO registrations 
         (firstName, lastName, normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [firstName, lastName, normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress],
        function(err) {
          if (err) reject(err);
          resolve(this.lastID);
        }
      );
    });

    res.json({ success: true, message: '✅ ثبت‌نام با موفقیت انجام شد!' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

// 3. دریافت لیست ثبت‌نام‌ها (فقط با رمز 1234)
app.post('/api/admin/registrations', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    const registrations = await new Promise((resolve, reject) => {
      db.all(
        "SELECT id, firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC",
        (err, rows) => {
          if (err) reject(err);
          resolve(rows);
        }
      );
    });

    res.json({ registrations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. به‌روزرسانی تنظیمات (فقط با رمز 1234)
app.post('/api/admin/settings', async (req, res) => {
  try {
    const { password, maxCapacity, deadline } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    if (maxCapacity && parseInt(maxCapacity) > 0) {
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE settings SET value = ? WHERE key = 'maxCapacity'",
          [maxCapacity.toString()],
          (err) => {
            if (err) reject(err);
            resolve();
          }
        );
      });
    }

    if (deadline !== undefined) {
      await new Promise((resolve, reject) => {
        db.run(
          "UPDATE settings SET value = ? WHERE key = 'deadline'",
          [deadline || ''],
          (err) => {
            if (err) reject(err);
            resolve();
          }
        );
      });
    }

    res.json({ success: true, message: '✅ تنظیمات ذخیره شد!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. خروجی CSV (فقط با رمز 1234)
app.post('/api/admin/export', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== '1234') {
      return res.status(401).json({ error: 'رمز عبور اشتباه است!' });
    }

    const registrations = await new Promise((resolve, reject) => {
      db.all(
        "SELECT firstName, lastName, selectedOption, submittedAt FROM registrations ORDER BY id DESC",
        (err, rows) => {
          if (err) reject(err);
          resolve(rows);
        }
      );
    });

    res.json({ registrations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== شروع سرور ====================
app.listen(PORT, () => {
  console.log(`✅ سرور با موفقیت روی پورت ${PORT} اجرا شد!`);
  console.log(`🌐 آدرس: http://localhost:${PORT}`);
});