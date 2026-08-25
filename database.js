const mongoose = require('mongoose');

// ============================================
// رشته اتصال MongoDB (با اطلاعات شما)
// ============================================
const MONGODB_URI = 'mongodb+srv://aryadan91_db_user:Jqc4uOZR3r5hDxjf@cluster0.taysa7o.mongodb.net/registrationDB?retryWrites=true&w=majority&appName=Cluster0';

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    console.log('✅ قبلاً به MongoDB متصل هستیم');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log('✅ اتصال به MongoDB با موفقیت برقرار شد!');
  } catch (error) {
    console.error('❌ خطا در اتصال به MongoDB:', error.message);
    throw error;
  }
}

// ============================================
// مدل‌های دیتابیس
// ============================================

const registrationSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  normalizedFirst: { type: String, required: true },
  normalizedLast: { type: String, required: true },
  selectedOption: { type: String, required: true },
  deviceId: { type: String, required: true, unique: true },
  ipAddress: { type: String },
  submittedAt: { type: Date, default: Date.now }
});

// ایندکس‌ها برای سرعت
registrationSchema.index({ normalizedFirst: 1, normalizedLast: 1 });
registrationSchema.index({ deviceId: 1 });
registrationSchema.index({ submittedAt: -1 });

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: { type: String }
});

const Registration = mongoose.model('Registration', registrationSchema);
const Setting = mongoose.model('Setting', settingsSchema);

// ============================================
// توابع کمکی
// ============================================

async function getSettings() {
  const settings = await Setting.find();
  const result = {};
  settings.forEach(s => { result[s.key] = s.value; });
  return result;
}

async function getCount() {
  return await Registration.countDocuments();
}

async function getAllRegistrations() {
  return await Registration.find().sort({ submittedAt: -1 }).limit(100);
}

async function addRegistration(data) {
  const reg = new Registration(data);
  await reg.save();
  return reg;
}

async function checkDuplicate(normalizedFirst, normalizedLast) {
  return await Registration.findOne({ normalizedFirst, normalizedLast });
}

async function checkDevice(deviceId) {
  return await Registration.findOne({ deviceId });
}

async function updateSettings(key, value) {
  await Setting.findOneAndUpdate(
    { key },
    { key, value },
    { upsert: true }
  );
}

// ============================================
// مقداردهی اولیه
// ============================================

async function initDB() {
  await connectDB();
  
  // تنظیمات پیش‌فرض
  const maxCapacity = await Setting.findOne({ key: 'maxCapacity' });
  if (!maxCapacity) {
    await Setting.create({ key: 'maxCapacity', value: '60' });
    await Setting.create({ key: 'deadline', value: '' });
  }
  
  console.log('✅ دیتابیس MongoDB آماده است!');
}

initDB();

module.exports = {
  connectDB,
  getSettings,
  getCount,
  getAllRegistrations,
  addRegistration,
  checkDuplicate,
  checkDevice,
  updateSettings
};
