const mongoose = require('mongoose');

// ============================================
// رشته اتصال MongoDB
// ============================================
const MONGODB_URI = 'mongodb+srv://aryadan91_db_user:Jqc4uOZR3r5hDxjf@cluster0.taysa7o.mongodb.net/registrationDB?retryWrites=true&w=majority&appName=Cluster0';

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
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
// مدل‌ها
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
// توابع
// ============================================

async function getSettings() {
  await connectDB();
  const settings = await Setting.find();
  const result = {};
  settings.forEach(s => { result[s.key] = s.value; });
  return result;
}

async function getCount() {
  await connectDB();
  return await Registration.countDocuments();
}

async function getAllRegistrations() {
  await connectDB();
  return await Registration.find().sort({ submittedAt: -1 }).limit(100);
}

async function addRegistration(data) {
  await connectDB();
  const reg = new Registration(data);
  await reg.save();
  return reg;
}

async function checkDuplicate(normalizedFirst, normalizedLast) {
  await connectDB();
  return await Registration.findOne({ normalizedFirst, normalizedLast });
}

async function checkDevice(deviceId) {
  await connectDB();
  return await Registration.findOne({ deviceId });
}

async function updateSettings(key, value) {
  await connectDB();
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
  try {
    await connectDB();
    
    const maxCapacity = await Setting.findOne({ key: 'maxCapacity' });
    if (!maxCapacity) {
      await Setting.create({ key: 'maxCapacity', value: '60' });
      await Setting.create({ key: 'deadline', value: '' });
    }
    
    console.log('✅ دیتابیس MongoDB آماده است!');
  } catch (error) {
    console.error('❌ خطا در مقداردهی:', error);
  }
}

initDB();

module.exports = {
  getSettings,
  getCount,
  getAllRegistrations,
  addRegistration,
  checkDuplicate,
  checkDevice,
  updateSettings
};
