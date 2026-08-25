const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./database');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// ==================== Middleware (بهینه شده) ====================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// تنظیمات CORS برای پذیرش درخواست از همه جا (حل مشکل اندروید)
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
  windowMs: 15 * 60 * 1000, // 15 دقیقه
  max: 200 // حداکثر 200 درخواست
});
app.use('/api/', limiter);

// ==================== توابع کمکی ====================

// نرمال‌سازی متن (ضدتقلب)
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

// دریافت تنظیمات
function getSettings() {
  return new Promise((resolve, reject) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
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
      if (err) {
        reject(err);
        return;
      }
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
        if (err) {
          reject(err);
          return;
        }
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
    console.error('Error in /api/status:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

// 2. ثبت‌نام جدید
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, selectedOption, deviceId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';

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
          if (err) {
            reject(err);
            return;
          }
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
          if (err) {
            reject(err);
            return;
          }
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
        [firstName.trim(), lastName.trim(), normalizedFirst, normalizedLast, selectedOption, deviceId, ipAddress],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve(this.lastID);
        }
      );
    });

    res.json({ success: true, message: '✅ ثبت‌نام با موفقیت انجام شد!' });

  } catch (error) {
    console.error('Error in /api/register:', error);
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
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });

    res.json({ registrations });
  } catch (error) {
    console.error('Error in /api/admin/registrations:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
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
            if (err) {
              reject(err);
              return;
            }
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
            if (err) {
              reject(err);
              return;
            }
            resolve();
          }
        );
      });
    }

    res.json({ success: true, message: '✅ تنظیمات ذخیره شد!' });
  } catch (error) {
    console.error('Error in /api/admin/settings:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
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
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });

    res.json({ registrations });
  } catch (error) {
    console.error('Error in /api/admin/export:', error);
    res.status(500).json({ error: 'خطای سرور: ' + error.message });
  }
});

// 6. مسیر پیش‌فرض برای رفع مشکل 404 در اندروید
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== شروع سرور ====================
app.listen(PORT, () => {
  console.log(`✅ سرور با موفقیت روی پورت ${PORT} اجرا شد!`);
  console.log(`🌐 آدرس: http://localhost:${PORT}`);
});

// ==================== مدیریت خطاهای سرور ====================
process.on('uncaughtException', (err) => {
  console.error('❌ خطای غیرمنتظره:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ خطای غیرمنتظره در Promise:', err);
});
