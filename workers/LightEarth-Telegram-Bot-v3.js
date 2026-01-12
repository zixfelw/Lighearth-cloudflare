// LightEarth Telegram Bot - Cloudflare Worker with KV Storage
// Version: 3.0 - KV WRITES OPTIMIZATION
//
// CHANGES IN v3.0:
// - 🚀 Giảm 80% KV writes: Chỉ save khi có thay đổi thực sự
// - 📦 Batch ALL saves cuối cron: Không save ngay lập tức trong loop
// - ⚡ Smart state comparison: So sánh state trước khi quyết định save
// - 🔒 Fix race condition bằng in-memory tracking thay vì immediate save
//
// FEATURES:
// - 📋 Thông báo ngưỡng gọn gàng: 1 dòng mỗi chỉ số
// - ⏰ Báo cáo mỗi giờ chi tiết với thời tiết + tips
// - 🔌 Voltage số thập phân: 50.5V thay vì làm tròn 51V
// - 🔢 Hỗ trợ dấu phẩy: nhập 50,5 = 50.5
// - 📊 Hiển thị chính xác trong mọi thông báo
// - 🔋 Battery Voltage Alerts: batteryVoltHigh và batteryVoltLow
// - 🔔 Alert Once: chỉ báo 1 lần/ngày/ngưỡng
// - 🔗 Ultra Short Deep Link: ≤64 chars
// - 🎉 Fun Messages + Serious Alerts
// - ⚡ Weather Cache per cron run
// - 📦 Batch KV operations
//
// DEPLOYMENT:
// 1. Environment Variables: PI_URL, PI_TOKEN, BOT_TOKEN
// 2. KV Namespace Binding: BOT_KV
// 3. Cron Trigger: */5 * * * *
//
// SECURITY: BOT_TOKEN should be set as environment variable

// ============================================
// 🔑 TOKEN & API CONFIGURATION
// ============================================
// IMPORTANT: Replace YOUR_BOT_TOKEN_HERE with actual token in Cloudflare Dashboard
// Or set BOT_TOKEN as environment variable (recommended for security)
const BOT_TOKEN = typeof env !== 'undefined' && env.BOT_TOKEN ? env.BOT_TOKEN : '8471250396:AAGFvYBxwzmYQeivR0tBUPrDoqHHNnsfwdU';
const TELEGRAM_API = 'https://api.telegram.org/bot' + BOT_TOKEN;

// ============================================
// 🌐 CORS CONFIGURATION
// ============================================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-API-Key',
  'Access-Control-Max-Age': '86400'
};

function corsResponse(body, options = {}) {
  const headers = { ...CORS_HEADERS, ...(options.headers || {}) };
  return new Response(body, { ...options, headers });
}

function jsonResponse(data, status = 200) {
  return corsResponse(JSON.stringify(data, null, 2), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}

// ============================================
// 📦 KV STORAGE CONFIGURATION
// ============================================
const KV_KEYS = {
  DEVICES: 'devices_data',
  DEVICE_STATES: 'device_states',
  HA_CACHE: 'ha_cache',
  THRESHOLD_ALERTS: 'threshold_alerts',
  NOTIFICATION_FLAGS: 'notification_flags'
};

// Cache TTLs
const HA_CACHE_TTL = 21600;      // 6 hours
const WEATHER_CACHE_TTL = 3600;  // 1 hour

// ============================================
// ⚙️ DEFAULT CONFIGURATIONS
// ============================================
const DEFAULT_THRESHOLDS = {
  batteryFull: 100,
  batteryLow: 20,
  pvDaily: 0,
  gridUsage: 0,
  loadDaily: 0,
  batteryVoltHigh: 0,  // 0 = TẮT, VD: 55V
  batteryVoltLow: 0    // 0 = TẮT, VD: 45V
};

const DEFAULT_DEVICES_DATA = [];

// ============================================
// 💾 KV STORAGE FUNCTIONS - OPTIMIZED BATCH
// ============================================
async function loadDevicesData(env) {
  if (!env.BOT_KV) return [...DEFAULT_DEVICES_DATA];
  try {
    const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' });
    if (data && Array.isArray(data)) {
      data.forEach(d => { if (!d.thresholds) d.thresholds = { ...DEFAULT_THRESHOLDS }; });
      return data;
    }
    return [...DEFAULT_DEVICES_DATA];
  } catch (e) { return [...DEFAULT_DEVICES_DATA]; }
}

async function saveDevicesData(env, data) {
  if (!env.BOT_KV) return false;
  try { await env.BOT_KV.put(KV_KEYS.DEVICES, JSON.stringify(data)); return true; } catch (e) { return false; }
}

async function loadDeviceStates(env) {
  if (!env.BOT_KV) return {};
  try { return (await env.BOT_KV.get(KV_KEYS.DEVICE_STATES, { type: 'json' })) || {}; } catch (e) { return {}; }
}

async function saveDeviceStates(env, states) {
  if (!env.BOT_KV) return false;
  try { await env.BOT_KV.put(KV_KEYS.DEVICE_STATES, JSON.stringify(states)); return true; } catch (e) { return false; }
}

// ============================================
// 🎯 THRESHOLD ALERT MANAGEMENT - BATCH OPTIMIZED
// ============================================
async function loadAllThresholdAlerts(env) {
  if (!env.BOT_KV) return {};
  try { return (await env.BOT_KV.get(KV_KEYS.THRESHOLD_ALERTS, { type: 'json' })) || {}; } catch (e) { return {}; }
}

async function saveAllThresholdAlerts(env, alerts) {
  if (!env.BOT_KV) return false;
  try { await env.BOT_KV.put(KV_KEYS.THRESHOLD_ALERTS, JSON.stringify(alerts)); return true; } catch (e) { return false; }
}

function getThresholdAlertKey(alerts, type, chatId, deviceId) {
  const key = `${type}_${chatId}_${deviceId}`;
  return alerts[key] || null;
}

function setThresholdAlertKey(alerts, type, chatId, deviceId, value) {
  const key = `${type}_${chatId}_${deviceId}`;
  alerts[key] = String(value);
}

function clearThresholdAlertKey(alerts, type, chatId, deviceId) {
  const key = `${type}_${chatId}_${deviceId}`;
  delete alerts[key];
}

function clearAllThresholdAlertsForDevice(alerts, chatId, deviceId) {
  const types = ['full', 'low', 'pv', 'grid', 'load', 'bvhigh', 'bvlow'];
  types.forEach(type => {
    const key = `${type}_${chatId}_${deviceId}`;
    delete alerts[key];
  });
}

// ============================================
// 🚩 NOTIFICATION FLAGS - BATCH OPTIMIZED
// ============================================
async function loadNotificationFlags(env) {
  if (!env.BOT_KV) return {};
  try { return (await env.BOT_KV.get(KV_KEYS.NOTIFICATION_FLAGS, { type: 'json' })) || {}; } catch (e) { return {}; }
}

async function saveNotificationFlags(env, flags) {
  if (!env.BOT_KV) return false;
  try { await env.BOT_KV.put(KV_KEYS.NOTIFICATION_FLAGS, JSON.stringify(flags)); return true; } catch (e) { return false; }
}

// In-memory user conversation states
const userStates = new Map();

// In-memory weather cache (per cron run)
let weatherCache = {};
function resetWeatherCache() { weatherCache = {}; }


// ============================================
// 🗺️ VIETNAM CITIES DATABASE
// ============================================
const VIETNAM_CITIES = {
  "TP. Ho Chi Minh": { lat: 10.8231, lon: 106.6297, region: "Mien Nam" },
  "Ba Ria - Vung Tau": { lat: 10.4114, lon: 107.1362, region: "Mien Nam" },
  "Binh Duong": { lat: 11.0753, lon: 106.6189, region: "Mien Nam" },
  "Binh Phuoc": { lat: 11.7512, lon: 106.7235, region: "Mien Nam" },
  "Dong Nai": { lat: 10.9574, lon: 106.8426, region: "Mien Nam" },
  "Tay Ninh": { lat: 11.3555, lon: 106.1099, region: "Mien Nam" },
  "Long An": { lat: 10.6956, lon: 106.2431, region: "Mien Nam" },
  "Tien Giang": { lat: 10.4493, lon: 106.3420, region: "Mien Nam" },
  "Ben Tre": { lat: 10.2433, lon: 106.3752, region: "Mien Nam" },
  "Vinh Long": { lat: 10.2537, lon: 105.9722, region: "Mien Nam" },
  "Tra Vinh": { lat: 9.8127, lon: 106.2993, region: "Mien Nam" },
  "Dong Thap": { lat: 10.4937, lon: 105.6882, region: "Mien Nam" },
  "An Giang": { lat: 10.5216, lon: 105.1259, region: "Mien Nam" },
  "Kien Giang": { lat: 10.0125, lon: 105.0809, region: "Mien Nam" },
  "Can Tho": { lat: 10.0452, lon: 105.7469, region: "Mien Nam" },
  "Hau Giang": { lat: 9.7579, lon: 105.6413, region: "Mien Nam" },
  "Soc Trang": { lat: 9.6037, lon: 105.9800, region: "Mien Nam" },
  "Bac Lieu": { lat: 9.2940, lon: 105.7216, region: "Mien Nam" },
  "Ca Mau": { lat: 9.1769, lon: 105.1524, region: "Mien Nam" },
  "Da Nang": { lat: 16.0544, lon: 108.2022, region: "Mien Trung" },
  "Thua Thien Hue": { lat: 16.4637, lon: 107.5909, region: "Mien Trung" },
  "Quang Nam": { lat: 15.5394, lon: 108.0191, region: "Mien Trung" },
  "Quang Ngai": { lat: 15.1214, lon: 108.8044, region: "Mien Trung" },
  "Binh Dinh": { lat: 13.7765, lon: 109.2237, region: "Mien Trung" },
  "Phu Yen": { lat: 13.0882, lon: 109.0929, region: "Mien Trung" },
  "Khanh Hoa": { lat: 12.2388, lon: 109.1967, region: "Mien Trung" },
  "Ninh Thuan": { lat: 11.5752, lon: 108.9890, region: "Mien Trung" },
  "Binh Thuan": { lat: 10.9289, lon: 108.1021, region: "Mien Trung" },
  "Quang Binh": { lat: 17.4656, lon: 106.6222, region: "Mien Trung" },
  "Quang Tri": { lat: 16.7504, lon: 107.1856, region: "Mien Trung" },
  "Ha Tinh": { lat: 18.3559, lon: 105.8877, region: "Mien Trung" },
  "Nghe An": { lat: 18.6737, lon: 105.6922, region: "Mien Trung" },
  "Thanh Hoa": { lat: 19.8067, lon: 105.7852, region: "Mien Trung" },
  "Kon Tum": { lat: 14.3545, lon: 108.0005, region: "Tay Nguyen" },
  "Gia Lai": { lat: 13.9833, lon: 108.0000, region: "Tay Nguyen" },
  "Dak Lak": { lat: 12.6800, lon: 108.0378, region: "Tay Nguyen" },
  "Dak Nong": { lat: 12.0033, lon: 107.6876, region: "Tay Nguyen" },
  "Lam Dong": { lat: 11.9404, lon: 108.4583, region: "Tay Nguyen" },
  "Ha Noi": { lat: 21.0285, lon: 105.8542, region: "Mien Bac" },
  "Hai Phong": { lat: 20.8449, lon: 106.6881, region: "Mien Bac" },
  "Quang Ninh": { lat: 21.0064, lon: 107.2925, region: "Mien Bac" },
  "Bac Giang": { lat: 21.2819, lon: 106.1975, region: "Mien Bac" },
  "Bac Ninh": { lat: 21.1861, lon: 106.0763, region: "Mien Bac" },
  "Hai Duong": { lat: 20.9373, lon: 106.3146, region: "Mien Bac" },
  "Hung Yen": { lat: 20.6464, lon: 106.0511, region: "Mien Bac" },
  "Thai Binh": { lat: 20.4463, lon: 106.3365, region: "Mien Bac" },
  "Nam Dinh": { lat: 20.4388, lon: 106.1621, region: "Mien Bac" },
  "Ninh Binh": { lat: 20.2506, lon: 105.9745, region: "Mien Bac" },
  "Ha Nam": { lat: 20.5835, lon: 105.9230, region: "Mien Bac" },
  "Vinh Phuc": { lat: 21.3609, lon: 105.5474, region: "Mien Bac" },
  "Phu Tho": { lat: 21.3227, lon: 105.2280, region: "Mien Bac" },
  "Thai Nguyen": { lat: 21.5942, lon: 105.8482, region: "Mien Bac" },
  "Bac Kan": { lat: 22.1470, lon: 105.8348, region: "Mien Bac" },
  "Cao Bang": { lat: 22.6663, lon: 106.2522, region: "Mien Bac" },
  "Lang Son": { lat: 21.8537, lon: 106.7615, region: "Mien Bac" },
  "Tuyen Quang": { lat: 21.8233, lon: 105.2180, region: "Mien Bac" },
  "Ha Giang": { lat: 22.8333, lon: 104.9833, region: "Mien Bac" },
  "Yen Bai": { lat: 21.7168, lon: 104.8986, region: "Mien Bac" },
  "Lao Cai": { lat: 22.4856, lon: 103.9707, region: "Mien Bac" },
  "Lai Chau": { lat: 22.3864, lon: 103.4703, region: "Mien Bac" },
  "Dien Bien": { lat: 21.3860, lon: 103.0230, region: "Mien Bac" },
  "Son La": { lat: 21.3256, lon: 103.9188, region: "Mien Bac" },
  "Hoa Binh": { lat: 20.8171, lon: 105.3376, region: "Mien Bac" }
};

// ============================================
// 📍 SHORT LOCATION CODES
// ============================================
const LOCATION_CODES = {
  'hcm': 'TP. Ho Chi Minh', 'hn': 'Ha Noi', 'dng': 'Da Nang', 'ct': 'Can Tho',
  'bd': 'Binh Duong', 'tn': 'Tay Ninh', 'dn': 'Dong Nai', 'dl': 'Lam Dong',
  'la': 'Long An', 'tg': 'Tien Giang', 'bt': 'Ben Tre', 'vl': 'Vinh Long',
  'tv': 'Tra Vinh', 'dt': 'Dong Thap', 'ag': 'An Giang', 'kg': 'Kien Giang',
  'hg': 'Hau Giang', 'st': 'Soc Trang', 'bl': 'Bac Lieu', 'cm': 'Ca Mau',
  'brvt': 'Ba Ria - Vung Tau', 'bp': 'Binh Phuoc', 'tth': 'Thua Thien Hue',
  'qna': 'Quang Nam', 'qng': 'Quang Ngai', 'bdi': 'Binh Dinh', 'py': 'Phu Yen',
  'kh': 'Khanh Hoa', 'nt': 'Ninh Thuan', 'bth': 'Binh Thuan', 'qb': 'Quang Binh',
  'qt': 'Quang Tri', 'hti': 'Ha Tinh', 'na': 'Nghe An', 'th': 'Thanh Hoa',
  'kt': 'Kon Tum', 'gl': 'Gia Lai', 'dlk': 'Dak Lak', 'dno': 'Dak Nong',
  'hp': 'Hai Phong', 'qni': 'Quang Ninh', 'bg': 'Bac Giang', 'bn': 'Bac Ninh',
  'hdu': 'Hai Duong', 'hy': 'Hung Yen', 'tb': 'Thai Binh', 'nd': 'Nam Dinh',
  'nb': 'Ninh Binh', 'hna': 'Ha Nam', 'vp': 'Vinh Phuc', 'pt': 'Phu Tho',
  'tnu': 'Thai Nguyen', 'bk': 'Bac Kan', 'cb': 'Cao Bang', 'ls': 'Lang Son',
  'tqu': 'Tuyen Quang', 'hgi': 'Ha Giang', 'yb': 'Yen Bai', 'lc': 'Lao Cai',
  'lch': 'Lai Chau', 'db': 'Dien Bien', 'sla': 'Son La', 'hbi': 'Hoa Binh'
};

function decodeLocationCode(code) {
  if (!code) return "TP. Ho Chi Minh";
  const lowerCode = code.toLowerCase();
  if (LOCATION_CODES[lowerCode]) return LOCATION_CODES[lowerCode];
  for (const [short, full] of Object.entries(LOCATION_CODES)) {
    if (lowerCode.includes(short) || short.includes(lowerCode)) return full;
  }
  const decoded = code.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  for (const city of Object.keys(VIETNAM_CITIES)) {
    if (city.toLowerCase().replace(/[^a-z0-9]/g, '') === decoded.toLowerCase().replace(/[^a-z0-9]/g, '')) return city;
  }
  return "TP. Ho Chi Minh";
}

function encodeLocationCode(cityName) {
  if (!cityName) return 'hcm';
  for (const [code, name] of Object.entries(LOCATION_CODES)) {
    if (name === cityName) return code;
  }
  return 'hcm';
}

// ============================================
// 🔢 NOTIFICATION BITS PARSING
// ============================================
function parseNotificationBits(bits) {
  const defaultNotifs = { morningGreeting: true, powerOutage: true, powerRestored: true, lowBattery: true, pvEnded: true, hourlyStatus: false };
  if (!bits || bits.length !== 6) return defaultNotifs;
  return {
    morningGreeting: bits[0] === '1',
    powerOutage: bits[1] === '1',
    powerRestored: bits[2] === '1',
    lowBattery: bits[3] === '1',
    pvEnded: bits[4] === '1',
    hourlyStatus: bits[5] === '1'
  };
}

function encodeNotificationBits(notifications) {
  if (!notifications) return '111110';
  return [
    notifications.morningGreeting ? '1' : '0',
    notifications.powerOutage ? '1' : '0',
    notifications.powerRestored ? '1' : '0',
    notifications.lowBattery ? '1' : '0',
    notifications.pvEnded ? '1' : '0',
    notifications.hourlyStatus ? '1' : '0'
  ].join('');
}

// ============================================
// 🕐 TIME HELPERS (Vietnam Timezone)
// ============================================
function getVietnamTime() { return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', ''); }
function getVietnamHour() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours(); }
function getVietnamDate() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0]; }

// ============================================
// 🎨 ICONS & STATUS HELPERS
// ============================================
function getBatteryIcon(soc) {
  if (soc <= 5) return '🔴';
  if (soc <= 20) return '🟠';
  if (soc <= 50) return '🟡';
  if (soc <= 80) return '🟢';
  return '💚';
}

function getGridIcon(hasGrid) { return hasGrid ? '🟢' : '🔴'; }

function getWeatherIcon(code) {
  const icons = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌧️', 53: '🌧️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 80: '🌦️', 81: '🌦️', 82: '🌦️', 95: '⛈️', 96: '⛈️' };
  return icons[code] || '🌤️';
}

function getBatteryFunStatus(soc) {
  if (soc >= 90) return '💪 Siêu đầy!';
  if (soc >= 80) return '💚 Tuyệt vời!';
  if (soc >= 60) return '🟢 Tốt lắm!';
  if (soc >= 40) return '🟡 OK';
  if (soc >= 20) return '🟠 Hơi thấp';
  return '🔴 Cần sạc!';
}

function getRandomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================
// 🎉 FUN & FRIENDLY MESSAGE TEMPLATES
// ============================================
const MORNING_GREETINGS = [
  "🌅 *Chào buổi sáng!*",
  "☀️ *Good morning!*",
  "🌞 *Chào ngày mới!*",
  "🌄 *Ohayo!*",
  "✨ *Rise & Shine!*",
  "🔆 *Xin chào!*",
  "🌻 *Hello Sunshine!*",
  "⭐ *Chào buổi sáng!*"
];

// ============================================
// 🌤️ SMART WEATHER-BASED MESSAGES v2.9 - 300+ MESSAGES
// ============================================

// Temperature categories - EXPANDED
const TEMP_MESSAGES = {
  very_cold: [ // < 15°C - 20 messages
    "🥶 Trời lạnh quá, nhớ giữ ấm nhé!",
    "❄️ Tiết trời se lạnh, uống trà nóng thôi!",
    "🧥 Lạnh thế này, mặc áo ấm nha!",
    "🌡️ Nhiệt độ thấp, giữ gìn sức khỏe!",
    "❄️ Rét đậm rồi, cẩn thận cảm lạnh!",
    "🥶 Trời lành lạnh, PV vẫn làm việc!",
    "🧣 Lạnh cóng tay, uống gì ấm nhé!",
    "❄️ Tiết trời giá rét, ở trong nhà thôi!",
    "🥶 Lạnh như miền Bắc luôn!",
    "🌬️ Gió lạnh thổi, mặc ấm nha!",
    "❄️ Rét buốt, PV vẫn hoạt động!",
    "🧥 Thời tiết lạnh, giữ ấm cơ thể!",
    "🥶 Nhiệt độ xuống thấp, cẩn thận!",
    "❄️ Trời lạnh căm, ủ ấm thôi!",
    "🌡️ Se lạnh quá, uống nước ấm!",
    "🧣 Lạnh như mùa đông châu Âu!",
    "❄️ Gió bấc về, lạnh lắm nha!",
    "🥶 Tiết trời giá lạnh, giữ sức khỏe!",
    "🌬️ Lạnh thấu xương, ở nhà tốt hơn!",
    "❄️ Nhiệt độ thấp, nhưng PV vẫn OK!"
  ],
  cold: [ // 15-20°C - 20 messages
    "🌬️ Trời mát mẻ dễ chịu!",
    "🍃 Tiết trời se lạnh, rất dễ chịu!",
    "🌡️ Nhiệt độ mát, làm việc hiệu quả!",
    "🧊 Trời hơi lạnh nhưng dễ chịu!",
    "🌬️ Gió mát nhẹ, ngày đẹp trời!",
    "🍂 Thời tiết mát mẻ, thoải mái!",
    "🌤️ Se lạnh nhẹ, rất thích!",
    "🍃 Gió thu về, dễ chịu quá!",
    "🌡️ Mát mẻ, lý tưởng để ra ngoài!",
    "🌬️ Thời tiết mát lạnh, tuyệt vời!",
    "🍂 Không nóng không lạnh, hoàn hảo!",
    "🌤️ Tiết trời mát, thoáng đãng!",
    "🍃 Gió nhẹ, không khí trong lành!",
    "🌡️ Se lạnh dễ chịu, ngày tốt lành!",
    "🌬️ Mát mẻ, PV vẫn hoạt động tốt!",
    "🍂 Thời tiết thu, lý tưởng!",
    "🌤️ Nhiệt độ dễ chịu, vui vẻ nha!",
    "🍃 Gió mát, không khí sạch!",
    "🌡️ Se lạnh, mặc áo mỏng là đủ!",
    "🌬️ Thời tiết mát, thoải mái hoạt động!"
  ],
  warm: [ // 20-30°C - 20 messages
    "🌤️ Thời tiết ấm áp dễ chịu!",
    "☀️ Nhiệt độ lý tưởng để hoạt động!",
    "🌞 Trời đẹp, PV hoạt động tốt!",
    "✨ Thời tiết tuyệt vời!",
    "🌻 Nắng ấm áp, ngày tốt lành!",
    "🌈 Thời tiết hoàn hảo!",
    "☀️ Ấm áp, ra ngoài thôi!",
    "🌤️ Nhiệt độ vừa phải, dễ chịu!",
    "🌞 Trời đẹp, tận hưởng ngày mới!",
    "✨ Thời tiết ấm, vui vẻ nha!",
    "🌻 Nắng nhẹ, rất thoải mái!",
    "🌈 Ngày hoàn hảo cho hoạt động!",
    "☀️ Ấm áp, năng lượng tràn đầy!",
    "🌤️ Thời tiết lý tưởng!",
    "🌞 Nhiệt độ dễ chịu, PV tốt!",
    "✨ Ấm áp, ngày mới tuyệt vời!",
    "🌻 Trời đẹp, khí hậu ôn hòa!",
    "🌈 Thời tiết hoàn hảo cho solar!",
    "☀️ Ấm áp dễ chịu, thoải mái!",
    "🌤️ Nhiệt độ vàng, ngày đẹp!"
  ],
  hot: [ // 30-35°C - 20 messages
    "🔥 Trời nóng, nhớ uống nhiều nước!",
    "☀️ Nắng gắt, PV thu hoạch cực tốt!",
    "🌡️ Nhiệt độ cao, tránh nắng nhé!",
    "💦 Nóng quá, bật quạt thôi!",
    "🔆 Trời nắng to, năng lượng dồi dào!",
    "☀️ Nóng bức, nhưng PV đang \\\"cháy\\\"!",
    "🌡️ Trời nóng, bật điều hòa nhé!",
    "💦 Nắng gắt, uống nước liên tục!",
    "🔥 Nóng như đổ lửa!",
    "☀️ Ra nắng cẩn thận say nắng!",
    "🌡️ Nhiệt độ cao, hạn chế ra ngoài!",
    "💦 Nóng bức, giải nhiệt thôi!",
    "🔆 Nắng to, PV thu hoạch max!",
    "☀️ Trời nóng, năng lượng dồi dào!",
    "🌡️ Nắng gắt, mang ô nhé!",
    "💦 Nóng quá, ăn gì mát đi!",
    "🔥 Nhiệt độ cao, PV đỉnh cao!",
    "☀️ Nắng như thiêu, cẩn thận!",
    "🌡️ Trời nóng, uống nhiều nước!",
    "💦 Nắng to, giữ sức khỏe nhé!"
  ],
  very_hot: [ // > 35°C - 20 messages
    "🥵 Nắng nóng gay gắt, cẩn thận say nắng!",
    "🔥 Nhiệt độ cực cao, ở trong nhà nhé!",
    "☀️ Nắng như đổ lửa, PV thu hoạch max!",
    "🌡️ Nóng kinh khủng, uống nước liên tục!",
    "💥 Đỉnh điểm nắng nóng, PV bứt phá!",
    "🥵 Trời nóng như thiêu, giữ sức khỏe!",
    "🔥 Nắng đổ lửa, tránh ra ngoài!",
    "☀️ Nhiệt độ kỷ lục, PV cực mạnh!",
    "🌡️ Nóng như lò nung!",
    "💥 Nắng gắt cực điểm!",
    "🥵 Trời như đổ lửa!",
    "🔥 Cực nóng, ở trong nhà!",
    "☀️ Nắng dữ dội, PV max power!",
    "🌡️ Nhiệt độ nguy hiểm!",
    "💥 Nắng như sa mạc!",
    "🥵 Nóng chảy mỡ, cẩn thận!",
    "🔥 Đỉnh điểm nắng nóng!",
    "☀️ Cảnh báo nắng nóng!",
    "🌡️ Nóng kỷ lục, giữ sức!",
    "💥 PV thu hoạch kỷ lục!"
  ]
};

// Humidity categories - EXPANDED
const HUMIDITY_MESSAGES = {
  dry: [ // < 40% - 15 messages
    "💨 Độ ẩm thấp, không khí khô!",
    "🌵 Hanh khô, nhớ dưỡng ẩm!",
    "💧 Khô ráo, thời tiết dễ chịu!",
    "🏜️ Không khí khô, uống nhiều nước!",
    "💨 Hanh hao, da cần dưỡng ẩm!",
    "🌾 Độ ẩm thấp, dễ chịu!",
    "💧 Khô khan, bổ sung nước!",
    "🏜️ Không khí khô hanh!",
    "💨 Hanh khô, thoa kem dưỡng!",
    "🌾 Độ ẩm thấp, thoải mái!",
    "💧 Khô ráo, không oi bức!",
    "🏜️ Khô hanh, uống đủ nước!",
    "💨 Không khí khô, dễ thở!",
    "🌾 Hanh khô, PV hoạt động tốt!",
    "💧 Độ ẩm thấp, sảng khoái!"
  ],
  normal: [ // 40-70% - 15 messages
    "💧 Độ ẩm vừa phải, thoải mái!",
    "🌿 Không khí trong lành!",
    "✨ Độ ẩm lý tưởng!",
    "🌱 Không khí dễ chịu!",
    "💧 Độ ẩm hoàn hảo!",
    "🌿 Thoáng mát, dễ thở!",
    "✨ Không khí tuyệt vời!",
    "🌱 Độ ẩm chuẩn, thoải mái!",
    "💧 Không oi không khô, perfect!",
    "🌿 Độ ẩm vừa phải, dễ chịu!",
    "✨ Không khí trong lành, sảng khoái!",
    "🌱 Độ ẩm lý tưởng cho sức khỏe!",
    "💧 Thoải mái, không cần máy lọc!",
    "🌿 Không khí tự nhiên, tuyệt vời!",
    "✨ Độ ẩm hoàn hảo, vui vẻ!"
  ],
  humid: [ // > 70% - 15 messages (NO temperature-dependent words like 'oi bức')
    "💦 Độ ẩm cao, không khí ẩm!",
    "🌫️ Ẩm ướt, có thể có mưa!",
    "💧 Không khí ẩm, giữ đồ điện khô!",
    "🌧️ Ẩm cao, cảm giác ẩm ướt!",
    "💦 Độ ẩm rất cao, không khí nặng!",
    "🌫️ Ẩm ướt, có thể sương mù!",
    "💧 Ẩm cao, cảm giác ẩm!",
    "🌧️ Độ ẩm cao, trời có thể mưa!",
    "💦 Không khí ẩm ướt!",
    "🌫️ Ẩm cao, dễ đổ mồ hôi!",
    "💧 Độ ẩm rất cao!",
    "🌧️ Ẩm ướt, cẩn thận đồ điện!",
    "💦 Không khí ẩm, có thể mưa!",
    "🌫️ Độ ẩm cao, trời ẩm!",
    "💧 Ẩm ướt, không khí nặng!"
  ]
};

// Wind categories - EXPANDED  
const WIND_MESSAGES = {
  calm: [ // < 10 km/h - 15 messages
    "🍃 Gió nhẹ, trời yên bình!",
    "✨ Không khí tĩnh lặng!",
    "🌸 Gió thoảng nhẹ nhàng!",
    "🌿 Lặng gió, dễ chịu!",
    "🍃 Không gió, trời êm!",
    "✨ Yên bình, tĩnh lặng!",
    "🌸 Gió hiu hiu!",
    "🌿 Không có gió mạnh!",
    "🍃 Lặng gió, thoải mái!",
    "✨ Trời yên, gió nhẹ!",
    "🌸 Gió thoang thoảng!",
    "🌿 Không khí tĩnh mịch!",
    "🍃 Gió nhẹ như không!",
    "✨ Yên ả, bình yên!",
    "🌸 Nhẹ nhàng, êm đềm!"
  ],
  breezy: [ // 10-25 km/h - 15 messages
    "💨 Gió mát nhẹ thổi!",
    "🌬️ Có gió, dễ chịu!",
    "🍃 Gió lồng lộng, thoáng mát!",
    "💨 Gió nhẹ, mát mẻ!",
    "🌬️ Có gió mát, sảng khoái!",
    "🍃 Gió thổi nhẹ nhàng!",
    "💨 Thoáng gió, dễ chịu!",
    "🌬️ Gió mát, thoải mái!",
    "🍃 Có gió, không nóng!",
    "💨 Gió nhẹ, rất dễ chịu!",
    "🌬️ Thoáng mát, có gió!",
    "🍃 Gió mát rượi!",
    "💨 Có gió mát, tuyệt vời!",
    "🌬️ Gió nhẹ, không oi bức!",
    "🍃 Gió lồng lộng, sảng khoái!"
  ],
  windy: [ // > 25 km/h - 15 messages
    "💨 Gió khá mạnh hôm nay!",
    "🌪️ Gió lớn, cẩn thận đồ bay!",
    "🌬️ Nhiều gió, chú ý an toàn!",
    "💨 Gió mạnh, giữ chặt mũ!",
    "🌪️ Gió to, cẩn thận!",
    "🌬️ Gió lớn, hạn chế ra ngoài!",
    "💨 Gió mạnh, bay đồ đấy!",
    "🌪️ Nhiều gió, cẩn thận nhé!",
    "🌬️ Gió to, giữ chặt!",
    "💨 Gió mạnh, thổi bay mọi thứ!",
    "🌪️ Gió lớn, an toàn trước!",
    "🌬️ Nhiều gió, cẩn trọng!",
    "💨 Gió to, đóng cửa sổ!",
    "🌪️ Gió mạnh, chú ý!",
    "🌬️ Gió lớn, giữ gìn đồ đạc!"
  ]
};

// Weather condition messages - EXPANDED 40 EACH
const WEATHER_CONDITION_MESSAGES = {
  sunny: [
    "☀️ Trời nắng đẹp, PV thu hoạch tốt!",
    "🌞 Nắng vàng rực rỡ, năng lượng dồi dào!",
    "🔆 Trời quang, PV hoạt động hiệu quả!",
    "☀️ Nắng đẹp, ngày tuyệt vời!",
    "🌻 Mặt trời tỏa sáng, PV đang \\\"hút\\\" nắng!",
    "✨ Trời trong xanh, PV chạy hết công suất!",
    "☀️ Nắng vàng óng, năng lượng tràn ngập!",
    "🌞 Trời nắng chói chang, PV max power!",
    "🔆 Mặt trời rực rỡ, thu hoạch tốt!",
    "☀️ Nắng đẹp tuyệt vời, PV \\\"bung lụa\\\"!",
    "🌻 Trời quang đãng, năng lượng xanh!",
    "✨ Nắng vàng rực, PV đỉnh cao!",
    "☀️ Trời trong, PV thu năng lượng!",
    "🌞 Nắng đẹp, hệ thống hoạt động tốt!",
    "🔆 Mặt trời chiếu sáng, PV \\\"cháy\\\"!",
    "☀️ Trời nắng, ngày hoàn hảo!",
    "🌻 Nắng chan hòa, năng lượng dồi dào!",
    "✨ Trời quang, PV hoạt động mạnh!",
    "☀️ Nắng rực, thu hoạch kỷ lục!",
    "🌞 Trời đẹp, PV đang làm việc!",
    "🔆 Nắng đẹp, năng lượng tràn đầy!",
    "☀️ Mặt trời rực rỡ, tuyệt vời!",
    "🌻 Trời trong xanh, PV max!",
    "✨ Nắng vàng, ngày solar hoàn hảo!",
    "☀️ Trời nắng, PV thu hoạch tốt!",
    "🌞 Nắng đẹp, năng lượng dồi dào!",
    "🔆 Trời quang đãng, PV mạnh!",
    "☀️ Mặt trời chiếu, thu năng lượng!",
    "🌻 Nắng vàng, PV hoạt động tốt!",
    "✨ Trời trong, ngày đẹp trời!"
  ],
  partly_cloudy: [
    "⛅ Nắng xen mây, PV vẫn hoạt động!",
    "🌤️ Có mây lác đác, không vấn đề!",
    "☁️ Mây che một phần, PV vẫn OK!",
    "🌥️ Ít mây, năng lượng vẫn ổn!",
    "⛅ Nắng nhẹ qua mây, PV cố gắng!",
    "🌤️ Mây lác đác, PV vẫn tốt!",
    "☁️ Có chút mây, không sao!",
    "🌥️ Nắng xen kẽ, PV hoạt động!",
    "⛅ Mây che thỉnh thoảng, OK!",
    "🌤️ Trời có mây, PV vẫn thu!",
    "☁️ Ít mây, nắng vẫn có!",
    "🌥️ Mây lác đác, không ảnh hưởng!",
    "⛅ Nắng sau mây, PV chờ đợi!",
    "🌤️ Có mây một chút, vẫn tốt!",
    "☁️ Mây che phần, PV OK!",
    "🌥️ Nắng xen mây, hoạt động tốt!",
    "⛅ Mây lác đác, PV vẫn chạy!",
    "🌤️ Có chút mây, năng lượng ổn!",
    "☁️ Ít mây, PV vẫn hoạt động!",
    "🌥️ Nắng qua mây, thu năng lượng!"
  ],
  cloudy: [
    "☁️ Trời nhiều mây, PV giảm công suất!",
    "🌥️ Mây che phủ, PV làm việc nhẹ!",
    "☁️ U ám một chút, PV nghỉ ngơi!",
    "🌫️ Trời âm u, pin sẽ hỗ trợ!",
    "☁️ Mây dày, PV hoạt động tối thiểu!",
    "🌥️ Nhiều mây, năng lượng giảm!",
    "☁️ Trời u ám, PV yếu!",
    "🌫️ Mây che, pin hỗ trợ!",
    "☁️ Nhiều mây, PV nghỉ ngơi!",
    "🌥️ Trời mây, công suất thấp!",
    "☁️ U ám, Grid hỗ trợ!",
    "🌫️ Mây dày đặc, PV yếu!",
    "☁️ Trời âm u, năng lượng thấp!",
    "🌥️ Nhiều mây che, PV chậm!",
    "☁️ Mây phủ, hoạt động yếu!",
    "🌫️ Trời u ám, pin đảm nhận!",
    "☁️ Nhiều mây, PV tối thiểu!",
    "🌥️ Mây che kín, năng lượng giảm!",
    "☁️ Trời mây, PV nghỉ ngơi!",
    "🌫️ U ám, hệ thống điều chỉnh!"
  ],
  overcast: [
    "☁️ Trời u ám, PV nghỉ ngơi thôi!",
    "🌫️ Mây đen che kín, pin lên sàn!",
    "☁️ Trời xám xịt, Grid hỗ trợ nhé!",
    "🌥️ Nhiều mây, PV hoạt động yếu!",
    "☁️ Không có nắng, pin đảm nhận!",
    "🌫️ Trời tối âm u, PV nghỉ!",
    "☁️ Mây che kín trời, năng lượng thấp!",
    "🌥️ U ám hoàn toàn, pin hỗ trợ!",
    "☁️ Không thấy mặt trời, PV off!",
    "🌫️ Trời xám đen, Grid đảm nhận!",
    "☁️ Mây dày đặc, không nắng!",
    "🌥️ Trời tối, PV không hoạt động!",
    "☁️ U ám, hệ thống chuyển pin!",
    "🌫️ Mây che hết, năng lượng 0!",
    "☁️ Trời xịt xám, pin lên sàn!"
  ],
  rainy: [
    "🌧️ Trời mưa, PV tạm nghỉ!",
    "☔ Mưa rơi, pin lên sàn thôi!",
    "🌧️ Mưa to, PV không hoạt động!",
    "💧 Trời mưa, tận hưởng tiếng mưa nhé!",
    "🌦️ Mưa lất phất, PV nghỉ ngơi!",
    "☔ Mưa rào, năng lượng từ pin!",
    "🌧️ Trời mưa, Grid hỗ trợ!",
    "💧 Mưa nhẹ, PV yếu!",
    "🌦️ Trời mưa, hệ thống OK!",
    "☔ Mưa to, ở nhà thôi!",
    "🌧️ Mưa lớn, PV nghỉ hoàn toàn!",
    "💧 Mưa rơi, pin đảm nhận!",
    "🌦️ Trời mưa, năng lượng dự trữ!",
    "☔ Mưa phùn, PV yếu!",
    "🌧️ Mưa nhiều, Grid hỗ trợ!",
    "💧 Trời mưa, thư giãn thôi!",
    "🌦️ Mưa rào, pin lên sàn!",
    "☔ Mưa to quá, ở nhà nha!",
    "🌧️ Mưa lớn, PV tạm nghỉ!",
    "💧 Mưa rơi tí tách, dễ chịu!"
  ],
  stormy: [
    "⛈️ Có dông, cẩn thận thiết bị!",
    "🌩️ Sấm sét, an toàn trước nhé!",
    "⚡ Dông bão, ổn định hệ thống!",
    "⛈️ Thời tiết xấu, Grid đang hỗ trợ!",
    "🌩️ Có giông, tránh xa ngoài trời!",
    "⚡ Sét đánh, cẩn thận!",
    "⛈️ Bão đến, ở trong nhà!",
    "🌩️ Dông bão, an toàn là trên hết!",
    "⚡ Sấm chớp, tắt thiết bị!",
    "⛈️ Thời tiết nguy hiểm!",
    "🌩️ Có dông sét, cẩn thận!",
    "⚡ Bão to, ở trong nhà nhé!",
    "⛈️ Sấm to, Grid hỗ trợ!",
    "🌩️ Dông bão, hệ thống ổn định!",
    "⚡ Thời tiết xấu, an toàn!"
  ],
  foggy: [
    "🌫️ Sương mù dày, PV yếu!",
    "🌁 Trời sương, năng lượng thấp!",
    "🌫️ Mù sương, PV hoạt động chậm!",
    "🌁 Sương mù dày đặc, nhìn khó!",
    "🌫️ Trời mù, PV nghỉ ngơi!",
    "🌁 Sương phủ, năng lượng thấp!",
    "🌫️ Mù dày, không thấy nắng!",
    "🌁 Trời sương, pin hỗ trợ!",
    "🌫️ Sương mù, PV yếu!",
    "🌁 Mù sương, cẩn thận đi lại!",
    "🌫️ Trời mù mịt, năng lượng thấp!",
    "🌁 Sương giăng, PV nghỉ!",
    "🌫️ Mù dày, Grid hỗ trợ!",
    "🌁 Trời sương phủ, hoạt động yếu!",
    "🌫️ Sương mù, chờ tan nhé!"
  ]
};

// UV-based messages - EXPANDED
const UV_MESSAGES = {
  low: [ // 0-2 - 10 messages
    "🌡️ UV thấp, da an toàn!",
    "😊 Không cần lo chống nắng!",
    "✨ UV nhẹ, thoải mái ra ngoài!",
    "🌤️ UV thấp, không sợ cháy da!",
    "😊 UV an toàn, vui vẻ!",
    "✨ Không cần kem chống nắng!",
    "🌡️ UV nhẹ nhàng, OK!",
    "😊 An toàn cho da, thoải mái!",
    "✨ UV thấp, ra ngoài thoải mái!",
    "🌤️ Không lo UV, dễ chịu!"
  ],
  moderate: [ // 3-5 - 10 messages
    "☀️ UV trung bình, nên che chắn!",
    "🧴 UV vừa, bôi kem chống nắng!",
    "🌤️ UV OK, PV hoạt động tốt!",
    "☀️ UV vừa phải, cẩn thận!",
    "🧴 Nên che chắn khi ra nắng!",
    "🌤️ UV trung bình, mang mũ!",
    "☀️ Cẩn thận da, UV vừa!",
    "🧴 Bôi kem chống nắng nhé!",
    "🌤️ UV OK, nhưng che chắn!",
    "☀️ UV vừa, bảo vệ da!"
  ],
  high: [ // 6-7 - 10 messages
    "🔆 UV cao, bảo vệ da nhé!",
    "☀️ UV mạnh, PV thu hoạch tốt!",
    "⚠️ UV cao, tránh nắng trực tiếp!",
    "🔆 UV mạnh, che chắn kỹ!",
    "☀️ UV cao, cẩn thận cháy da!",
    "⚠️ Bảo vệ da, UV cao!",
    "🔆 UV mạnh, mang ô!",
    "☀️ UV cao, PV mạnh!",
    "⚠️ Cẩn thận, UV cao!",
    "🔆 Tránh nắng, UV mạnh!"
  ],
  very_high: [ // 8-10 - 10 messages
    "🔥 UV rất cao, che chắn kỹ!",
    "☀️ UV cực mạnh, PV đỉnh cao!",
    "⚠️ Nguy hiểm! Hạn chế ra nắng!",
    "🔥 UV rất mạnh, cẩn thận!",
    "☀️ UV cao ngất, PV max!",
    "⚠️ UV nguy hiểm, ở trong nhà!",
    "🔥 Cháy da nhanh, cẩn thận!",
    "☀️ UV cực mạnh, thu hoạch lớn!",
    "⚠️ Hạn chế ra nắng, UV cao!",
    "🔥 UV rất cao, bảo vệ da!"
  ],
  extreme: [ // > 10 - 10 messages
    "🥵 UV cực kỳ cao, ở trong nhà!",
    "☀️ UV max, PV thu hoạch kỷ lục!",
    "🚨 UV nguy hiểm, bảo vệ bản thân!",
    "🥵 UV cực điểm, không ra ngoài!",
    "☀️ UV kỷ lục, PV max power!",
    "🚨 Cảnh báo UV nguy hiểm!",
    "🥵 UV cực cao, ở nhà!",
    "☀️ UV max, năng lượng tràn ngập!",
    "🚨 UV nguy hiểm, che chắn!",
    "🥵 UV kỷ lục, cần bảo vệ!"
  ]
};

// Rain chance messages - EXPANDED
const RAIN_MESSAGES = {
  none: [ // 0-10% - 10 messages
    "☀️ Không có mưa, thoải mái ra ngoài!",
    "🌞 Trời khô ráo!",
    "✨ Không lo mưa!",
    "☀️ Không mưa, vui vẻ!",
    "🌞 Trời khô, thoải mái!",
    "✨ Không có mưa, OK!",
    "☀️ Khô ráo, ra ngoài được!",
    "🌞 Không mưa, dễ chịu!",
    "✨ Trời khô, tuyệt vời!",
    "☀️ Không lo mưa, thoải mái!"
  ],
  low: [ // 10-30% - 10 messages
    "🌤️ Ít khả năng mưa!",
    "⛅ Có thể mưa nhẹ!",
    "🌥️ Mang dù phòng xa!",
    "🌤️ Mưa ít, không lo!",
    "⛅ Có thể mưa một chút!",
    "🌥️ Phòng xa mang dù!",
    "🌤️ Ít mưa, OK!",
    "⛅ Có thể có mưa nhẹ!",
    "🌥️ Mang dù đề phòng!",
    "🌤️ Ít khả năng, vẫn tốt!"
  ],
  moderate: [ // 30-60% - 10 messages
    "🌦️ Có thể mưa, mang dù nhé!",
    "☁️ Khả năng mưa cao!",
    "🌧️ Chuẩn bị có mưa!",
    "🌦️ Mưa có thể xảy ra!",
    "☁️ Mang dù theo nhé!",
    "🌧️ Khả năng mưa, cẩn thận!",
    "🌦️ Có thể mưa, đề phòng!",
    "☁️ Mưa có khả năng cao!",
    "🌧️ Chuẩn bị dù, mưa sắp đến!",
    "🌦️ Khả năng mưa, mang dù!"
  ],
  high: [ // > 60% - 10 messages
    "🌧️ Nhiều khả năng mưa!",
    "☔ Mang dù theo nhé!",
    "💧 Sẽ có mưa hôm nay!",
    "🌧️ Mưa chắc chắn, mang dù!",
    "☔ Sẽ mưa, đừng quên dù!",
    "💧 Mưa nhiều, ở nhà tốt!",
    "🌧️ Khả năng mưa rất cao!",
    "☔ Mưa to, mang áo mưa!",
    "💧 Chắc chắn mưa, cẩn thận!",
    "🌧️ Mưa sẽ đến, chuẩn bị!"
  ]
};

// Time-based greetings - PERSONALIZED with {deviceId}
const TIME_GREETINGS = {
  early_morning: [ // 5-8h
    { emoji: '🌅', label: 'SÁNG SỚM', greeting: 'Chào buổi sáng {deviceId}! Mặt trời vừa ló dạng!' },
    { emoji: '🌄', label: 'BÌNH MINH', greeting: 'Good morning {deviceId}! Ngày mới bắt đầu!' },
    { emoji: '🌤️', label: 'EARLY BIRD', greeting: 'Xin chào {deviceId}! Dậy sớm thế!' },
    { emoji: '☀️', label: 'CHÀO NGÀY MỚI', greeting: 'Hey {deviceId}! Sẵn sàng đón nắng chưa?' },
    { emoji: '🌞', label: 'SÁNG TINH MƠ', greeting: 'Ohayo {deviceId}! Chúc ngày mới tốt lành!' },
    { emoji: '✨', label: 'GOOD MORNING', greeting: 'Chào bạn {deviceId}! Năng lượng xanh sẵn sàng!' },
    { emoji: '🔆', label: 'KHỞI ĐẦU NGÀY', greeting: 'Hi {deviceId}! PV sắp khởi động!' },
    { emoji: '🌻', label: 'SÁNG SỚM', greeting: 'Hello {deviceId}! Bình minh đẹp quá!' },
    { emoji: '⭐', label: 'BUỔI SÁNG SỚM', greeting: 'Chào {deviceId}! Rise and shine!' },
    { emoji: '🌈', label: 'CHÀO BUỔI SÁNG', greeting: 'Xin chào {deviceId}! Ngày mới vui vẻ nhé!' }
  ],
  morning: [ // 8-12h
    { emoji: '☀️', label: 'BUỔI SÁNG', greeting: 'Chào buổi sáng {deviceId}! Nắng đẹp quá!' },
    { emoji: '🌞', label: 'MORNING', greeting: 'Good morning {deviceId}! PV đang làm việc!' },
    { emoji: '✨', label: 'SÁNG NAY', greeting: 'Hello {deviceId}! Sáng nay thế nào?' },
    { emoji: '🌤️', label: 'BUỔI SÁNG ĐẸP', greeting: 'Hi {deviceId}! Trời đẹp, năng lượng dồi dào!' },
    { emoji: '🔆', label: 'SÁNG NẮNG', greeting: 'Xin chào {deviceId}! Nắng vàng rực rỡ!' },
    { emoji: '🌻', label: 'CHÀO SÁNG', greeting: 'Chào {deviceId}! PV đang thu hoạch!' },
    { emoji: '⭐', label: 'GOOD MORNING', greeting: 'Hey {deviceId}! Buổi sáng tuyệt vời!' },
    { emoji: '🌈', label: 'SÁNG NAY', greeting: 'Hello {deviceId}! Chúc sáng vui vẻ!' },
    { emoji: '💫', label: 'BUỔI SÁNG VUI VẺ', greeting: 'Xin chào {deviceId}! Năng lượng xanh đang chạy!' },
    { emoji: '🎯', label: 'SÁNG NAY OK', greeting: 'Hi {deviceId}! Mọi thứ ổn sáng nay!' }
  ],
  noon: [ // 12-14h
    { emoji: '🌞', label: 'GIỮA TRƯA', greeting: 'Chào {deviceId}! Giữa trưa nắng gắt!' },
    { emoji: '🔆', label: 'NOON', greeting: 'Hi {deviceId}! Đỉnh cao năng lượng đây!' },
    { emoji: '☀️', label: 'TRƯA NAY', greeting: 'Hello {deviceId}! PV đang cháy hết công suất!' },
    { emoji: '🔥', label: 'ĐỈNH CAO NẮNG', greeting: 'Hey {deviceId}! Peak power time!' },
    { emoji: '💥', label: 'NOON REPORT', greeting: 'Xin chào {deviceId}! Báo cáo giữa trưa đây!' },
    { emoji: '⚡', label: 'GIỮA NGÀY', greeting: 'Chào {deviceId}! Năng lượng đỉnh cao!' },
    { emoji: '✨', label: 'TRƯA RỰC RỠ', greeting: 'Hi {deviceId}! Trưa rực rỡ, thu hoạch lớn!' },
    { emoji: '🌟', label: 'NOON TIME', greeting: 'Hello {deviceId}! Giờ vàng của PV!' },
    { emoji: '💎', label: 'GIỮA TRƯA NAY', greeting: 'Chào bạn {deviceId}! Nắng to quá!' },
    { emoji: '🎯', label: 'TRƯA OK', greeting: 'Hey {deviceId}! Trưa nay mọi thứ tốt!' }
  ],
  afternoon: [ // 14-17h
    { emoji: '🌤️', label: 'BUỔI CHIỀU', greeting: 'Chào buổi chiều {deviceId}!' },
    { emoji: '☀️', label: 'AFTERNOON', greeting: 'Good afternoon {deviceId}!' },
    { emoji: '✨', label: 'CHIỀU NAY', greeting: 'Hi {deviceId}! Chiều nay thế nào?' },
    { emoji: '🌞', label: 'CHIỀU NẮNG', greeting: 'Hello {deviceId}! Chiều vẫn còn nắng!' },
    { emoji: '💫', label: 'BUỔI CHIỀU VUI', greeting: 'Xin chào {deviceId}! Chiều vui vẻ nhé!' },
    { emoji: '🔆', label: 'AFTERNOON REPORT', greeting: 'Chào {deviceId}! Báo cáo buổi chiều!' },
    { emoji: '⭐', label: 'CHIỀU ĐẸP', greeting: 'Hey {deviceId}! Chiều đẹp, PV vẫn hoạt động!' },
    { emoji: '🌈', label: 'CHIỀU NAY OK', greeting: 'Hi {deviceId}! Mọi thứ ổn chiều nay!' },
    { emoji: '💎', label: 'BUỔI CHIỀU NAY', greeting: 'Hello {deviceId}! Chiều tốt lành!' },
    { emoji: '🎯', label: 'CHIỀU VUI VẺ', greeting: 'Chào bạn {deviceId}! Chiều vui vẻ!' }
  ],
  late_afternoon: [ // 17-19h
    { emoji: '🌇', label: 'CHIỀU MUỘN', greeting: 'Chào {deviceId}! Chiều muộn rồi!' },
    { emoji: '🌆', label: 'SUNSET', greeting: 'Hi {deviceId}! Hoàng hôn đẹp quá!' },
    { emoji: '🌅', label: 'HOÀNG HÔN', greeting: 'Hello {deviceId}! PV sắp nghỉ ngơi!' },
    { emoji: '✨', label: 'CHIỀU TÀ', greeting: 'Xin chào {deviceId}! Hoàng hôn về!' },
    { emoji: '🔆', label: 'CUỐI CHIỀU', greeting: 'Chào bạn {deviceId}! Ngày sắp kết thúc!' },
    { emoji: '⭐', label: 'SUNSET REPORT', greeting: 'Hey {deviceId}! Báo cáo cuối ngày!' },
    { emoji: '💫', label: 'CHIỀU MUỘN', greeting: 'Hi {deviceId}! PV đang giảm công suất!' },
    { emoji: '🌈', label: 'HOÀNG HÔN ĐẸP', greeting: 'Hello {deviceId}! Sunset đẹp quá!' },
    { emoji: '💎', label: 'KẾT THÚC NGÀY', greeting: 'Chào {deviceId}! Ngày làm việc tốt!' },
    { emoji: '🎯', label: 'CHIỀU MUỘN NAY', greeting: 'Xin chào {deviceId}! Sắp tối rồi!' }
  ],
  evening: [ // 19-24h
    { emoji: '🌙', label: 'TỐI NAY', greeting: 'Chào buổi tối {deviceId}!' },
    { emoji: '🌃', label: 'EVENING', greeting: 'Good evening {deviceId}!' },
    { emoji: '✨', label: 'BUỔI TỐI', greeting: 'Hi {deviceId}! Tối nay thế nào?' },
    { emoji: '⭐', label: 'TỐI RỒI', greeting: 'Hello {deviceId}! PV đã nghỉ ngơi!' },
    { emoji: '🌟', label: 'EVENING REPORT', greeting: 'Xin chào {deviceId}! Báo cáo tối nay!' },
    { emoji: '💫', label: 'CHÀO BUỔI TỐI', greeting: 'Chào bạn {deviceId}! Tối vui vẻ nhé!' },
    { emoji: '🔆', label: 'TỐI NAY', greeting: 'Hey {deviceId}! Pin đang đảm nhận!' },
    { emoji: '🌈', label: 'BUỔI TỐI VUI VẺ', greeting: 'Hi {deviceId}! Chúc tối an lành!' },
    { emoji: '💎', label: 'TỐI NAY OK', greeting: 'Hello {deviceId}! Mọi thứ ổn tối nay!' },
    { emoji: '🎯', label: 'CHÚC TỐI VUI', greeting: 'Chào {deviceId}! Nghỉ ngơi nhé!' }
  ]
};

// ============================================
// 🎯 SMART MESSAGE GENERATOR
// ============================================

function getTemperatureCategory(temp) {
  if (temp < 15) return 'very_cold';
  if (temp < 20) return 'cold';
  if (temp < 30) return 'warm';
  if (temp < 35) return 'hot';
  return 'very_hot';
}

function getHumidityCategory(humidity) {
  if (humidity < 40) return 'dry';
  if (humidity < 70) return 'normal';
  return 'humid';
}

function getWindCategory(windSpeed) {
  if (windSpeed < 10) return 'calm';
  if (windSpeed < 25) return 'breezy';
  return 'windy';
}

function getUVCategory(uvIndex) {
  if (uvIndex <= 2) return 'low';
  if (uvIndex <= 5) return 'moderate';
  if (uvIndex <= 7) return 'high';
  if (uvIndex <= 10) return 'very_high';
  return 'extreme';
}

function getRainCategory(rainChance) {
  if (rainChance <= 10) return 'none';
  if (rainChance <= 30) return 'low';
  if (rainChance <= 60) return 'moderate';
  return 'high';
}

function getWeatherCondition(weather) {
  if (!weather) return 'sunny';
  const desc = (weather.currentDescription || weather.description || '').toLowerCase();

  if (desc.includes('dông') || desc.includes('storm') || desc.includes('thunder')) return 'stormy';
  if (desc.includes('mưa') || desc.includes('rain')) return 'rainy';
  if (desc.includes('sương') || desc.includes('fog') || desc.includes('mist')) return 'foggy';
  if (desc.includes('u ám') || desc.includes('overcast') || desc.includes('nhiều mây')) return 'overcast';
  if (desc.includes('mây') || desc.includes('cloud')) return 'cloudy';
  if (desc.includes('ít mây') || desc.includes('partly')) return 'partly_cloudy';
  if (weather.uvIndex >= 5 || desc.includes('nắng') || desc.includes('quang') || desc.includes('sun') || desc.includes('clear')) return 'sunny';

  // Default based on UV
  if (weather.uvIndex >= 3) return 'partly_cloudy';
  return 'cloudy';
}

// Main smart message generator - NOW WITH DEVICE ID PERSONALIZATION
function getSmartWeatherGreeting(weather, vnHour, deviceId = '') {
  // Get time period
  let timePeriod = 'morning';
  if (vnHour >= 5 && vnHour < 8) timePeriod = 'early_morning';
  else if (vnHour >= 8 && vnHour < 12) timePeriod = 'morning';
  else if (vnHour >= 12 && vnHour < 14) timePeriod = 'noon';
  else if (vnHour >= 14 && vnHour < 17) timePeriod = 'afternoon';
  else if (vnHour >= 17 && vnHour < 19) timePeriod = 'late_afternoon';
  else timePeriod = 'evening';

  const timeGreeting = getRandomItem(TIME_GREETINGS[timePeriod]);
  const devId = deviceId || 'LightEarth';

  // Replace {deviceId} placeholder with actual device ID
  const personalGreeting = timeGreeting.greeting
    ? timeGreeting.greeting.replace('{deviceId}', devId)
    : 'Hệ thống đang hoạt động!';

  // Create personalized label with deviceId - e.g. "TỐI NAY OK P250801055"
  const personalLabel = `${timeGreeting.label} ${devId}`;

  if (!weather) {
    return {
      emoji: timeGreeting.emoji,
      label: timeGreeting.label,
      personalLabel: personalLabel,
      greeting: personalGreeting,
      personalGreeting: personalGreeting
    };
  }

  // Get weather categories
  const tempCat = getTemperatureCategory(weather.currentTemp);
  const condition = getWeatherCondition(weather);

  // Primary: Weather condition message
  const conditionMsg = getRandomItem(WEATHER_CONDITION_MESSAGES[condition] || WEATHER_CONDITION_MESSAGES.cloudy);

  return {
    emoji: timeGreeting.emoji,
    label: timeGreeting.label,
    personalLabel: personalLabel,  // e.g. "TỐI NAY OK P250801055"
    greeting: conditionMsg,
    personalGreeting: personalGreeting
  };
}

// Smart weather tip based on ALL conditions
function getSmartWeatherTip(weather, pvPower) {
  if (!weather) return '';

  const temp = weather.currentTemp || 25;
  const humidity = weather.humidity || 50;
  const wind = weather.windSpeed || 0;
  const uv = weather.uvIndex || 0;
  const rain = weather.rainChance || 0;
  const condition = getWeatherCondition(weather);

  let tips = [];

  // Temperature tips
  const tempCat = getTemperatureCategory(temp);
  if (tempCat === 'very_cold') {
    tips.push(`❄️ _Trời lạnh ${temp}°C, giữ ấm nhé!_`);
  } else if (tempCat === 'cold') {
    tips.push(`🌬️ _Trời mát ${temp}°C, dễ chịu!_`);
  } else if (tempCat === 'hot') {
    tips.push(`🔥 _Nóng ${temp}°C, uống nhiều nước!_`);
  } else if (tempCat === 'very_hot') {
    tips.push(`🥵 _Nắng nóng ${temp}°C, cẩn thận!_`);
  }

  // Rain tips
  if (rain > 60) {
    tips.push(`🌧️ _${rain}% khả năng mưa, mang dù!_`);
  } else if (rain > 30) {
    tips.push(`🌦️ _${rain}% mưa, có thể đổ mưa!_`);
  }

  // UV tips (only if significant)
  if (uv >= 8) {
    tips.push(`☀️ _UV ${uv}: Cực cao! PV thu hoạch max!_`);
  } else if (uv >= 6) {
    tips.push(`🔆 _UV ${uv}: Cao! PV hoạt động tốt!_`);
  } else if (uv === 0 && condition !== 'rainy') {
    tips.push(`☁️ _UV 0: Mây che, PV yếu hơn bình thường._`);
  }

  // Wind tips (only if notable)
  if (wind > 30) {
    tips.push(`💨 _Gió ${wind}km/h, khá mạnh!_`);
  }

  // Humidity tips (only if extreme)
  if (humidity > 85) {
    tips.push(`💦 _Độ ẩm ${humidity}%, không khí rất ẩm!_`);
  } else if (humidity < 30) {
    tips.push(`🌵 _Độ ẩm ${humidity}%, hanh khô!_`);
  }

  // PV-based tips
  if (pvPower > 1000) {
    tips.push(`🔥 _PV đang \"cháy\" ${pvPower}W!_`);
  } else if (pvPower > 500) {
    tips.push(`⚡ _PV hoạt động mạnh ${pvPower}W!_`);
  } else if (pvPower > 100) {
    tips.push(`💡 _PV đang thu ${pvPower}W!_`);
  } else if (pvPower <= 10) {
    tips.push(`🌙 _PV nghỉ ngơi, pin đảm nhận!_`);
  }

  // Return 1-2 random tips
  if (tips.length === 0) {
    return `✨ _Thời tiết ${temp}°C, ${humidity}% ẩm!_`;
  }

  // Prioritize: temp/rain first, then others
  const shuffled = tips.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2).join('\n');
}

// Legacy function for compatibility (now uses smart system)
function getHourlyTemplate(vnHour, weather, deviceId = '') {
  return getSmartWeatherGreeting(weather, vnHour, deviceId);
}

function getWeatherTip(weather, pvPower) {
  return getSmartWeatherTip(weather, pvPower);
}


// ============================================
// 📱 DEVICE MANAGEMENT FUNCTIONS
// ============================================
function getUserDevices(devicesData, chatId) {
  return devicesData.filter(d => d.chatId === chatId);
}

async function addDeviceWithSettings(env, devicesData, chatId, deviceId, notifications, location, thresholds, alerts) {
  const upperDeviceId = deviceId.toUpperCase();
  const existingIndex = devicesData.findIndex(d => d.chatId === chatId && d.deviceId.toUpperCase() === upperDeviceId);

  const deviceData = {
    deviceId: upperDeviceId,
    chatId,
    addedAt: getVietnamTime(),
    location: location || "TP. Ho Chi Minh",
    notifications: notifications || { morningGreeting: true, powerOutage: true, powerRestored: true, lowBattery: true, pvEnded: true, hourlyStatus: false },
    thresholds: thresholds || { ...DEFAULT_THRESHOLDS }
  };

  if (existingIndex >= 0) {
    devicesData[existingIndex] = { ...devicesData[existingIndex], ...deviceData, addedAt: devicesData[existingIndex].addedAt };
    if (alerts) clearAllThresholdAlertsForDevice(alerts, chatId, upperDeviceId);
  } else {
    devicesData.push(deviceData);
  }

  await saveDevicesData(env, devicesData);
  return { success: true, isNew: existingIndex < 0, devicesData };
}

async function addDevice(env, devicesData, chatId, deviceId) {
  const exists = devicesData.some(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (exists) return { success: false, devicesData };
  devicesData.push({
    deviceId: deviceId.toUpperCase(),
    chatId,
    addedAt: getVietnamTime(),
    location: "TP. Ho Chi Minh",
    notifications: { morningGreeting: true, powerOutage: true, powerRestored: true, lowBattery: true, pvEnded: true, hourlyStatus: false },
    thresholds: { ...DEFAULT_THRESHOLDS }
  });
  await saveDevicesData(env, devicesData);
  return { success: true, devicesData };
}

async function removeDevice(env, devicesData, chatId, deviceId, alerts) {
  const index = devicesData.findIndex(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (index === -1) return { success: false, devicesData };
  if (alerts) clearAllThresholdAlertsForDevice(alerts, chatId, deviceId.toUpperCase());
  devicesData.splice(index, 1);
  await saveDevicesData(env, devicesData);
  return { success: true, devicesData };
}

async function updateDeviceSettings(env, devicesData, chatId, deviceId, settingNum) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device || !device.notifications) return null;
  const settingMap = { 1: 'morningGreeting', 2: 'pvEnded', 3: 'powerOutage', 4: 'powerRestored', 5: 'lowBattery', 6: 'hourlyStatus' };
  const setting = settingMap[settingNum];
  if (!setting) return null;
  device.notifications[setting] = !device.notifications[setting];
  await saveDevicesData(env, devicesData);
  return { setting, newValue: device.notifications[setting] };
}

async function updateSingleDeviceLocation(env, devicesData, chatId, deviceId, location) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) return false;
  device.location = location;
  await saveDevicesData(env, devicesData);
  return true;
}

async function updateDeviceThresholds(env, devicesData, chatId, deviceId, newThresholds, alerts) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) return false;
  const oldThresholds = device.thresholds || { ...DEFAULT_THRESHOLDS };
  device.thresholds = { ...oldThresholds, ...newThresholds };
  if (alerts) clearAllThresholdAlertsForDevice(alerts, chatId, deviceId.toUpperCase());
  await saveDevicesData(env, devicesData);
  return true;
}


// ============================================
// 🏠 HOME ASSISTANT API - OPTIMIZED
// ============================================
async function fetchAllDevicesFromHA(env) {
  const PI_URL = env.PI_URL || env.HA_URL;
  const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN;
  if (!PI_URL || !PI_TOKEN) return [];

  try {
    const response = await fetch(`${PI_URL}/api/states`, {
      headers: { 'Authorization': `Bearer ${PI_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) return [];

    const states = await response.json();
    const deviceIds = new Set();
    states.forEach(state => {
      const match = state.entity_id.match(/^sensor\.device_([a-z0-9]+)_/i);
      if (match) deviceIds.add(match[1].toUpperCase());
    });

    const devices = [];
    for (const deviceId of deviceIds) {
      const devicePrefix = `sensor.device_${deviceId.toLowerCase()}_`;
      const binaryPrefix = `binary_sensor.device_${deviceId.toLowerCase()}_`;
      const deviceStates = states.filter(s => s.entity_id.startsWith(devicePrefix));
      const binaryStates = states.filter(s => s.entity_id.startsWith(binaryPrefix));

      const getValue = (suffix) => {
        const entity = deviceStates.find(s => s.entity_id === `${devicePrefix}${suffix}`);
        return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null;
      };
      const parseNum = (val) => val !== null ? parseFloat(val) : 0;

      const onlineEntity = binaryStates.find(s => s.entity_id.includes('_online_status'));
      const isOnline = onlineEntity?.state === 'on' || (getValue('pv_power') !== null);
      const gridPower = Math.round(parseNum(getValue('grid_power')));
      const acInputVoltage = parseNum(getValue('ac_input_voltage')) || parseNum(getValue('grid_voltage'));
      const hasGridPower = gridPower > 50 || acInputVoltage > 100;
      const gridToday = Math.round(parseNum(getValue('grid_today')) * 100) / 100;
      const batteryVoltage = Math.round(parseNum(getValue('battery_voltage')) * 10) / 10;

      const pv1Voltage = Math.round(parseNum(getValue('pv1_voltage')) || 0);
      const pv2Voltage = Math.round(parseNum(getValue('pv2_voltage')) || 0);

      devices.push({
        deviceId, isOnline, hasGridPower,
        realtime: {
          batterySoc: Math.round(parseNum(getValue('battery_soc'))),
          pvPower: Math.round(parseNum(getValue('pv_power'))),
          pv1Voltage, pv2Voltage,  // PV1 & PV2 voltages for detecting truly OFF state
          batteryPower: Math.round(parseNum(getValue('battery_power'))),
          loadPower: Math.round(parseNum(getValue('total_load_power')) || parseNum(getValue('load_power'))),
          gridPower, acInputVoltage, batteryVoltage,
          temperature: Math.round(parseNum(getValue('device_temperature')) * 10) / 10
        },
        dailyEnergy: {
          pvDay: Math.round(parseNum(getValue('pv_today')) * 100) / 100,
          loadDay: Math.round((parseNum(getValue('total_load_today')) || parseNum(getValue('load_today'))) * 100) / 100,
          gridDay: gridToday
        }
      });
    }
    return devices;
  } catch (e) { return []; }
}

// Filter HA devices to only registered ones - OPTIMIZATION
function filterRegisteredDevices(haDevices, devicesData) {
  const registeredIds = new Set(devicesData.map(d => d.deviceId.toUpperCase()));
  return haDevices.filter(d => registeredIds.has(d.deviceId.toUpperCase()));
}

// ============================================
// 🌤️ WEATHER API - WITH CACHING
// ============================================
async function getWeather(location) {
  // Check cache first
  if (weatherCache[location]) {
    return weatherCache[location];
  }

  const city = VIETNAM_CITIES[location];
  if (!city) return null;

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=Asia/Ho_Chi_Minh&forecast_days=1`);
    if (response.ok) {
      const data = await response.json();
      const weatherCodes = { 0: 'Trời quang', 1: 'Ít mây', 2: 'Mây một phần', 3: 'Nhiều mây', 45: 'Sương mù', 48: 'Sương mù đông', 51: 'Mưa phùn nhẹ', 53: 'Mưa phùn', 55: 'Mưa phùn dày', 61: 'Mưa nhẹ', 63: 'Mưa vừa', 65: 'Mưa to', 80: 'Mưa rào nhẹ', 81: 'Mưa rào', 82: 'Mưa rào to', 95: 'Dông', 96: 'Dông kèm mưa đá' };
      const vnHour = getVietnamHour();
      const currentTemp = data.hourly?.temperature_2m?.[vnHour] || data.daily.temperature_2m_max[0];
      const sunrise = data.daily?.sunrise?.[0]?.split('T')[1]?.slice(0, 5) || '06:00';
      const sunset = data.daily?.sunset?.[0]?.split('T')[1]?.slice(0, 5) || '18:00';
      const hourlyWeatherCode = data.hourly?.weather_code?.[vnHour];
      const dailyCode = data.daily.weather_code[0];

      const weather = {
        description: weatherCodes[dailyCode] || 'Không rõ',
        currentDescription: weatherCodes[hourlyWeatherCode] || weatherCodes[dailyCode] || 'Không rõ',
        icon: getWeatherIcon(hourlyWeatherCode || dailyCode),
        tempMax: data.daily.temperature_2m_max[0],
        tempMin: data.daily.temperature_2m_min[0],
        currentTemp: Math.round(currentTemp),
        humidity: data.hourly?.relative_humidity_2m?.[vnHour] || 0,
        windSpeed: Math.round(data.hourly?.wind_speed_10m?.[vnHour] || 0),
        uvIndex: Math.round(data.hourly?.uv_index?.[vnHour] || 0),
        rainChance: data.daily.precipitation_probability_max[0] || 0,
        sunrise, sunset,
        source: 'open-meteo'
      };

      // Cache the result
      weatherCache[location] = weather;
      return weather;
    }
  } catch (e) { }

  // Fallback to wttr.in
  try {
    const cityQuery = location.replace(/\s+/g, '+');
    const response = await fetch(`https://wttr.in/${cityQuery}?format=j1`);
    if (response.ok) {
      const data = await response.json();
      const current = data.current_condition?.[0];
      const today = data.weather?.[0];
      const astronomy = today?.astronomy?.[0];

      if (current && today) {
        const weatherDesc = current.lang_vi?.[0]?.value || current.weatherDesc?.[0]?.value || 'Không rõ';
        const code = parseInt(current.weatherCode) || 0;

        const weather = {
          description: weatherDesc,
          currentDescription: weatherDesc,
          icon: getWeatherIcon(code === 113 ? 0 : code === 116 ? 1 : code === 119 ? 3 : code >= 176 ? 61 : 2),
          tempMax: parseFloat(today.maxtempC) || 0,
          tempMin: parseFloat(today.mintempC) || 0,
          currentTemp: parseFloat(current.temp_C) || 0,
          humidity: parseFloat(current.humidity) || 0,
          windSpeed: parseFloat(current.windspeedKmph) || 0,
          uvIndex: parseFloat(current.uvIndex) || 0,
          rainChance: parseFloat(today.hourly?.[12]?.chanceofrain) || 0,
          sunrise: astronomy?.sunrise?.replace(/\s*AM/i, '') || '06:00',
          sunset: astronomy?.sunset?.replace(/\s*PM/i, '').replace(/^(\d):/, '1$1:') || '18:00',
          source: 'wttr.in'
        };

        // Cache the result
        weatherCache[location] = weather;
        return weather;
      }
    }
  } catch (e) { }

  return null;
}

// ============================================
// 📤 TELEGRAM API
// ============================================
async function sendTelegram(chatId, text, env) {
  const token = env?.BOT_TOKEN || BOT_TOKEN;
  const api = 'https://api.telegram.org/bot' + token;
  try {
    const response = await fetch(api + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
    return (await response.json()).ok;
  } catch (e) {
    return false;
  }
}

// Debug version that returns full response
async function sendTelegramDebug(chatId, text, env) {
  const token = env?.BOT_TOKEN || BOT_TOKEN;
  const api = 'https://api.telegram.org/bot' + token;
  try {
    const response = await fetch(api + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
    const result = await response.json();
    return { sent: result.ok, response: result };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}


// ============================================
// 🔔 NOTIFICATION PROCESSING v2.6 - COMPACT FORMAT
// ============================================

async function processNotifications(env) {
  // Reset weather cache for this cron run
  resetWeatherCache();

  // Load all data in parallel - OPTIMIZATION
  const [devicesData, previousStates, thresholdAlerts, notificationFlags] = await Promise.all([
    loadDevicesData(env),
    loadDeviceStates(env),
    loadAllThresholdAlerts(env),
    loadNotificationFlags(env)
  ]);

  // Get unique device IDs from registered users
  const registeredDeviceIds = [...new Set(devicesData.map(d => d.deviceId.toUpperCase()))];
  if (registeredDeviceIds.length === 0) {
    return { sent: 0, checked: 0, haDevices: 0 };
  }

  // Fetch HA devices and filter to only registered ones - OPTIMIZATION
  const allHaDevices = await fetchAllDevicesFromHA(env);
  const haDevices = filterRegisteredDevices(allHaDevices, devicesData);

  const currentStates = {};
  const notifications = [];
  const vnHour = getVietnamHour();
  const vnDate = getVietnamDate();

  let alertsChanged = false;
  let flagsChanged = false;

  // Track sent hourly notifications in this run to prevent duplicates
  const sentHourlyThisRun = new Set();

  for (const userDevice of devicesData) {
    const deviceId = userDevice.deviceId.toUpperCase();
    const chatId = userDevice.chatId;
    const prefs = userDevice.notifications || {};
    const thresholds = userDevice.thresholds || { ...DEFAULT_THRESHOLDS };
    const stateKey = `${chatId}_${deviceId}`;
    const haDevice = haDevices.find(d => d.deviceId.toUpperCase() === deviceId);

    if (!haDevice) continue;

    const prevState = previousStates[stateKey] || {};
    const rt = haDevice.realtime;
    const de = haDevice.dailyEnergy;
    const currentState = {
      hasGridPower: haDevice.hasGridPower,
      batterySoc: rt.batterySoc,
      pvPower: rt.pvPower,
      isLowBattery: rt.batterySoc <= 20,
      hasPV: rt.pvPower > 0 || rt.pv1Voltage > 0 || rt.pv2Voltage > 0,  // Only HẾT PV when ALL: power=0, pv1Volt=0, pv2Volt=0
      lastUpdate: Date.now(),
      powerOutageTime: prevState.powerOutageTime || null
    };

    // ⚡ MẤT ĐIỆN LƯỚI - COMPACT v2.6
    if (prefs.powerOutage && prevState.hasGridPower === true && !currentState.hasGridPower) {
      currentState.powerOutageTime = Date.now();
      notifications.push({
        chatId,
        message: `⚡🔴 *MẤT ĐIỆN*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%*\nPV: *${rt.pvPower}W*\nTải: *${rt.loadPower}W*\n\n🕐 ${getVietnamTime()}`
      });
    }

    // ✅ CÓ ĐIỆN LẠI - COMPACT v2.6
    if (prefs.powerRestored && prevState.hasGridPower === false && currentState.hasGridPower) {
      let durationMsg = '';
      if (prevState.powerOutageTime) {
        const mins = Math.floor((Date.now() - prevState.powerOutageTime) / 60000);
        durationMsg = mins >= 60 ? `\nMất điện: *${Math.floor(mins / 60)}h${mins % 60}p*` : `\nMất điện: *${mins}p*`;
      }
      notifications.push({
        chatId,
        message: `✅🟢 *CÓ ĐIỆN LẠI*\n📱 \`${deviceId}\`\n\nGrid: *${rt.gridPower}W*\nPin: *${rt.batterySoc}%*${durationMsg}\n\n🕐 ${getVietnamTime()}`
      });
      currentState.powerOutageTime = null;
    }

    // 🪫 PIN YẾU - COMPACT v2.6
    if (prefs.lowBattery && !prevState.isLowBattery && currentState.isLowBattery) {
      notifications.push({
        chatId,
        message: `🪫🔴 *PIN YẾU*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%*\nPV: *${rt.pvPower}W*\nGrid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}\n\n🕐 ${getVietnamTime()}`
      });
    }

    // 🌇 KẾT THÚC NGÀY NẮNG - COMPACT v2.6
    if (prefs.pvEnded && prevState.hasPV && !currentState.hasPV && vnHour >= 16 && vnHour <= 19) {
      notifications.push({
        chatId,
        message: `🌇 *HẾT PV*\n📱 \`${deviceId}\`\n\nPV: *${rt.pvPower}W*\nPin: *${rt.batterySoc}%*\nGrid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}\n\n🕐 ${getVietnamTime()}`
      });
    }

    // ☀️ BẮT ĐẦU PV - Send ONCE per day when PV is generating (5AM-10AM)
    // Uses same setting bit as morningGreeting for backward compatibility
    // ONLY relies on daily flag - no prevState check to avoid issues when state is reset
    if (prefs.morningGreeting && vnHour >= 5 && vnHour <= 10 && currentState.hasPV) {
      const pvStartKey = `pvstart_${chatId}_${deviceId}`;
      // Only send if not already sent today
      if (notificationFlags[pvStartKey] !== vnDate) {
        // Mark as sent in memory - will be saved at end of cron run
        // v3.0: Removed immediate save to reduce KV writes
        notificationFlags[pvStartKey] = vnDate;
        flagsChanged = true;
        // Note: Race condition handled by in-memory tracking (sentHourlyThisRun)

        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');

        let weatherInfo = '';
        if (weather) {
          weatherInfo = `\n\n${weather.icon} ${weather.currentTemp}°C | ${weather.humidity}% | ☀️ UV: ${weather.uvIndex}`;
        }

        notifications.push({
          chatId,
          message: `☀️ *BẮT ĐẦU PV*\n📱 \`${deviceId}\`\n\nPV: *${rt.pvPower}W*\nPin: *${rt.batterySoc}%*\nGrid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${weatherInfo}\n\n🕐 ${getVietnamTime()}`
        });
      }
    }

    // ⏰ BÁO CÁO MỖI GIỜ - DETAILED v2.7 (like v2.4)
    if (prefs.hourlyStatus && vnHour >= 6 && vnHour <= 21) {
      const hourlyKey = `hourly_${chatId}_${deviceId}_${vnHour}`;

      // Skip if already sent in this run (prevents duplicates from duplicate device entries)
      if (sentHourlyThisRun.has(hourlyKey)) continue;

      if (notificationFlags[hourlyKey] !== vnDate) {
        // Mark as sent in memory - will be saved at end of cron run
        // v3.0: Removed immediate save to reduce KV writes
        sentHourlyThisRun.add(hourlyKey);
        notificationFlags[hourlyKey] = vnDate;
        flagsChanged = true;
        // Note: Race condition handled by in-memory tracking (sentHourlyThisRun)

        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
        const locationName = userDevice.location || 'TP. Ho Chi Minh';
        const template = getHourlyTemplate(vnHour, weather, deviceId);
        const weatherTip = getWeatherTip(weather, rt.pvPower);

        // PV status tip based on power
        let pvTip = '';
        if (rt.pvPower > 1000) pvTip = '\n\n🔥 _PV đang "cháy" hết công suất!_';
        else if (rt.pvPower > 500) pvTip = '\n\n⚡ _PV đang hoạt động mạnh mẽ!_';
        else if (rt.pvPower > 100) pvTip = '\n\n💡 _PV đang thu nạp năng lượng!_';
        else if (vnHour < 17 && vnHour >= 6) pvTip = '\n\n💡 _Chờ nắng lên để PV hoạt động_';
        else pvTip = '\n\n🌙 _PV nghỉ ngơi, pin đảm nhận!_';

        let weatherInfo = '';
        if (weather) {
          weatherInfo = `\n\n🌤️ *Thời tiết ${locationName}:*\n${weather.icon} ${weather.currentDescription}\n🌡️ Nhiệt độ: ${weather.currentTemp}°C | 💧 Độ ẩm: ${weather.humidity}% | 💨 Gió: ${weather.windSpeed} km/h\n☀️ UV: ${weather.uvIndex} | 🌧️ Mưa: ${weather.rainChance}%\n\n${weatherTip}`;
        }

        notifications.push({
          chatId,
          message: `${template.emoji} *${template.personalLabel || template.label}*\n${template.greeting}\n\n☀️ PV: *${rt.pvPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* ${getBatteryFunStatus(rt.batterySoc)}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${weatherInfo}${pvTip}\n\n🕐 ${getVietnamTime()}`
        });
      }
    }

    // ⚙️ CUSTOM THRESHOLD ALERTS - COMPACT v2.6

    // 🔋💚 PIN ĐẦY - COMPACT
    if (thresholds.batteryFull < 100 && rt.batterySoc >= thresholds.batteryFull) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'full', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryFull)) {
        notifications.push({
          chatId,
          message: `🔋💚 *PIN ĐẦY*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%* (ngưỡng: ${thresholds.batteryFull}%)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'full', chatId, deviceId, thresholds.batteryFull);
        alertsChanged = true;
      }
    }

    // 🪫🔴 PIN THẤP - COMPACT
    if (thresholds.batteryLow > 0 && rt.batterySoc <= thresholds.batteryLow) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'low', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryLow)) {
        notifications.push({
          chatId,
          message: `🪫🔴 *PIN THẤP*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%* (ngưỡng: ${thresholds.batteryLow}%)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'low', chatId, deviceId, thresholds.batteryLow);
        alertsChanged = true;
      }
    }

    // 🔌🔴 ĐIỆN ÁP CAO - COMPACT
    if (thresholds.batteryVoltHigh > 0 && rt.batteryVoltage >= thresholds.batteryVoltHigh) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'bvhigh', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryVoltHigh)) {
        notifications.push({
          chatId,
          message: `🔌🔴 *ĐIỆN ÁP CAO*\n📱 \`${deviceId}\`\n\nĐiện áp: *${rt.batteryVoltage}V* (ngưỡng: ${thresholds.batteryVoltHigh}V)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'bvhigh', chatId, deviceId, thresholds.batteryVoltHigh);
        alertsChanged = true;
      }
    }

    // 🔌🟡 ĐIỆN ÁP THẤP - COMPACT
    if (thresholds.batteryVoltLow > 0 && rt.batteryVoltage > 0 && rt.batteryVoltage <= thresholds.batteryVoltLow) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'bvlow', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryVoltLow)) {
        notifications.push({
          chatId,
          message: `🔌🟡 *ĐIỆN ÁP THẤP*\n📱 \`${deviceId}\`\n\nĐiện áp: *${rt.batteryVoltage}V* (ngưỡng: ${thresholds.batteryVoltLow}V)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'bvlow', chatId, deviceId, thresholds.batteryVoltLow);
        alertsChanged = true;
      }
    }

    // ☀️🎉 PV ĐẠT NGƯỠNG - COMPACT
    if (thresholds.pvDaily > 0 && de.pvDay >= thresholds.pvDaily) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'pv', chatId, deviceId);
      if (alertedValue !== String(thresholds.pvDaily)) {
        notifications.push({
          chatId,
          message: `☀️🎉 *SẢN LƯỢNG PV*\n📱 \`${deviceId}\`\n\nPV: *${de.pvDay}kWh* (ngưỡng: ${thresholds.pvDaily}kWh)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'pv', chatId, deviceId, thresholds.pvDaily);
        alertsChanged = true;
      }
    }

    // ⚡⚠️ EVN ĐẠT NGƯỠNG - COMPACT
    if (thresholds.gridUsage > 0 && de.gridDay >= thresholds.gridUsage) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'grid', chatId, deviceId);
      if (alertedValue !== String(thresholds.gridUsage)) {
        notifications.push({
          chatId,
          message: `⚡⚠️ *ĐIỆN EVN*\n📱 \`${deviceId}\`\n\nEVN: *${de.gridDay}kWh* (ngưỡng: ${thresholds.gridUsage}kWh)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'grid', chatId, deviceId, thresholds.gridUsage);
        alertsChanged = true;
      }
    }

    // 🏠📈 TIÊU THỤ ĐẠT NGƯỠNG - COMPACT
    if (thresholds.loadDaily > 0 && de.loadDay >= thresholds.loadDaily) {
      const alertedValue = getThresholdAlertKey(thresholdAlerts, 'load', chatId, deviceId);
      if (alertedValue !== String(thresholds.loadDaily)) {
        notifications.push({
          chatId,
          message: `🏠📈 *TIÊU THỤ*\n📱 \`${deviceId}\`\n\nTiêu thụ: *${de.loadDay}kWh* (ngưỡng: ${thresholds.loadDaily}kWh)\n\n🕐 ${getVietnamTime()}`
        });
        setThresholdAlertKey(thresholdAlerts, 'load', chatId, deviceId, thresholds.loadDaily);
        alertsChanged = true;
      }
    }

    currentStates[stateKey] = currentState;
  }

  // v3.0: Batch save all changes - ONLY when changed to reduce KV writes
  const savePromises = [];

  // Only save device states if there's actual state change
  const hasStateChanges = Object.keys(currentStates).some(key => {
    const curr = currentStates[key];
    const prev = previousStates[key];
    if (!prev) return true; // New state
    // Check for meaningful changes
    return curr.hasGridPower !== prev.hasGridPower ||
      curr.batterySoc !== prev.batterySoc ||
      curr.isLowBattery !== prev.isLowBattery ||
      curr.hasPV !== prev.hasPV;
  });

  if (hasStateChanges) {
    savePromises.push(saveDeviceStates(env, { ...previousStates, ...currentStates }));
  }

  if (alertsChanged) savePromises.push(saveAllThresholdAlerts(env, thresholdAlerts));
  if (flagsChanged) savePromises.push(saveNotificationFlags(env, notificationFlags));

  if (savePromises.length > 0) {
    await Promise.all(savePromises);
  }

  // Send notifications with minimal delay
  for (const notif of notifications) {
    await sendTelegram(notif.chatId, notif.message, env);
    await new Promise(r => setTimeout(r, 50)); // Reduced delay
  }

  return { sent: notifications.length, checked: devicesData.length, haDevices: haDevices.length };
}


// ============================================
// 📋 TELEGRAM COMMAND HANDLERS
// ============================================

async function handleHelp(chatId, devicesData, env) {
  const userDevices = getUserDevices(devicesData, chatId);
  let thresholdsInfo = '';

  if (userDevices.length > 0) {
    const th = userDevices[0].thresholds || DEFAULT_THRESHOLDS;
    thresholdsInfo = `\n\n⚙️ *Ngưỡng cảnh báo:*\n🔋 Pin đầy: ${th.batteryFull}%${th.batteryFull >= 100 ? ' ❌' : ' ✅'}\n🪫 Pin thấp: ${th.batteryLow}% ${th.batteryLow > 0 ? '✅' : '❌'}\n🔌 Điện áp cao: ${(th.batteryVoltHigh || 0)}V${(th.batteryVoltHigh || 0) <= 0 ? ' ❌' : ' ✅'}\n🔌 Điện áp thấp: ${(th.batteryVoltLow || 0)}V${(th.batteryVoltLow || 0) <= 0 ? ' ❌' : ' ✅'}\n☀️ PV/ngày: ${th.pvDaily}kWh${th.pvDaily <= 0 ? ' ❌' : ' ✅'}\n⚡ EVN/ngày: ${th.gridUsage}kWh${th.gridUsage <= 0 ? ' ❌' : ' ✅'}\n🏠 Tiêu thụ/ngày: ${th.loadDaily}kWh${th.loadDaily <= 0 ? ' ❌' : ' ✅'}`;
  }

  await sendTelegram(chatId, `🤖 *LightEarth Bot v2.7*\n📋 _Compact Notifications_\n━━━━━━━━━━━━━━━━━\n\n📱 *Quản lý thiết bị:*\n/add <ID> - ➕ Thêm\n/remove <ID> - ➖ Xóa\n/list - 📋 Danh sách\n\n📊 *Trạng thái:*\n/status - 📈 Tất cả\n/check <ID> - 🔍 Chi tiết\n\n⚙️ *Cài đặt:*\n/settings - 🔔 Thông báo\n/thresholds - 🎯 Ngưỡng\n/location - 📍 Vùng${thresholdsInfo}`, env);
}

async function handleThresholds(chatId, args, devicesData, env) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `⚙️ *Ngưỡng*\n\n_(Chưa có thiết bị)_\n\n➕ /add`, env); return; }

  if (args.length === 0 && userDevices.length > 1) {
    let list = `🎯 *Ngưỡng cảnh báo*\n\nChọn thiết bị:\n\n`;
    userDevices.forEach((d, i) => { const th = d.thresholds || DEFAULT_THRESHOLDS; list += `${i + 1}. 📱 \`${d.deviceId}\`\n`; });
    list += `\n📝 Nhập số:`;
    userStates.set(chatId, { waiting: 'thresholds_device', devices: userDevices.map(d => d.deviceId) });
    await sendTelegram(chatId, list, env);
    return;
  }

  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy`, env); return; }

  const th = device.thresholds || DEFAULT_THRESHOLDS;
  userStates.set(chatId, { waiting: 'thresholds_select', deviceId: device.deviceId });
  await sendTelegram(chatId, `🎯 *Ngưỡng* \`${device.deviceId}\`\n\n1️⃣ Pin đầy: *${th.batteryFull}%* ${th.batteryFull >= 100 ? '❌' : '✅'}\n2️⃣ Pin thấp: *${th.batteryLow}%*\n3️⃣ Điện áp cao: *${(th.batteryVoltHigh || 0)}V* ${(th.batteryVoltHigh || 0) <= 0 ? '❌' : '✅'}\n4️⃣ Điện áp thấp: *${(th.batteryVoltLow || 0)}V* ${(th.batteryVoltLow || 0) <= 0 ? '❌' : '✅'}\n5️⃣ PV/ngày: *${th.pvDaily}kWh* ${th.pvDaily <= 0 ? '❌' : '✅'}\n6️⃣ EVN/ngày: *${th.gridUsage}kWh* ${th.gridUsage <= 0 ? '❌' : '✅'}\n7️⃣ Tiêu thụ/ngày: *${th.loadDaily}kWh* ${th.loadDaily <= 0 ? '❌' : '✅'}\n\n📝 Nhập 1-7 hoặc 0 thoát`, env);
}

async function handleAdd(chatId, args, env, devicesData) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'add_device' }); await sendTelegram(chatId, `➕ *Thêm*\n\n📝 Nhập Device ID:`, env); return devicesData; }
  const deviceId = args[0].toUpperCase();
  if (!/^[HP]\d{6,}$/.test(deviceId)) { await sendTelegram(chatId, `❌ ID không hợp lệ (H/P + số)`, env); return devicesData; }
  const haDevices = await fetchAllDevicesFromHA(env);
  if (!haDevices.some(d => d.deviceId?.toUpperCase() === deviceId)) { await sendTelegram(chatId, `❌ \`${deviceId}\` chưa có trong hệ thống`, env); return devicesData; }
  const result = await addDevice(env, devicesData, chatId, deviceId);
  await sendTelegram(chatId, result.success ? `✅ Đã thêm \`${deviceId}\`\n\n⚙️ /settings /thresholds /location` : `ℹ️ Đã có`, env);
  return result.devicesData;
}

async function handleRemove(chatId, args, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📋 Chưa có thiết bị`, env); return devicesData; }
  if (args.length === 0) { let list = `➖ *Xóa*\n\n`; userDevices.forEach((d, i) => { list += `${i + 1}. \`${d.deviceId}\`\n`; }); list += `\n📝 Nhập số/ID:`; userStates.set(chatId, { waiting: 'remove_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list, env); return devicesData; }
  let deviceId = args[0];
  if (/^\d+$/.test(deviceId)) { const idx = parseInt(deviceId) - 1; if (idx >= 0 && idx < userDevices.length) deviceId = userDevices[idx].deviceId; }
  const alerts = await loadAllThresholdAlerts(env);
  const result = await removeDevice(env, devicesData, chatId, deviceId, alerts);
  if (result.success) await saveAllThresholdAlerts(env, alerts);
  await sendTelegram(chatId, result.success ? `✅ Đã xóa \`${deviceId.toUpperCase()}\`` : `❌ Không tìm thấy`, env);
  return result.devicesData;
}

async function handleList(chatId, devicesData, env) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📋 *Danh sách*\n\n_(Trống)_\n\n➕ /add`, env); return; }
  let msg = `📋 *Danh sách*\n\n`;
  userDevices.forEach((d, i) => { msg += `${i + 1}. \`${d.deviceId}\` - ${d.location || "HCM"}\n`; });
  await sendTelegram(chatId, msg, env);
}

async function handleStatus(chatId, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📊 *Trạng thái*\n\n_(Chưa có)_\n\n➕ /add`, env); return; }
  const haDevices = await fetchAllDevicesFromHA(env);
  let msg = `📊 *Trạng thái*\n━━━━━━━━\n\n`;
  for (const userDevice of userDevices) {
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === userDevice.deviceId.toUpperCase());
    if (haDevice?.realtime) {
      const rt = haDevice.realtime;
      msg += `📱 *${userDevice.deviceId}* ${haDevice.isOnline ? '🟢' : '🔴'}\nPV: ${rt.pvPower}W | Pin: ${rt.batterySoc}%\nTải: ${rt.loadPower}W | Grid: ${rt.gridPower}W ${getGridIcon(haDevice.hasGridPower)}\n\n`;
    }
    else { msg += `📱 *${userDevice.deviceId}* ⚠️ Không có dữ liệu\n\n`; }
  }
  msg += `🕐 ${getVietnamTime()}`;
  await sendTelegram(chatId, msg, env);
}

async function handleCheck(chatId, args, env) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'check_device' }); await sendTelegram(chatId, `🔍 *Kiểm tra*\n\n📝 Nhập Device ID:`, env); return; }
  const deviceId = args[0].toUpperCase();
  const haDevices = await fetchAllDevicesFromHA(env);
  const device = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId);
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy \`${deviceId}\``, env); return; }
  const rt = device.realtime, de = device.dailyEnergy;
  await sendTelegram(chatId, `📊 *${deviceId}* ${device.isOnline ? '🟢' : '🔴'}\n━━━━━━━━\n\nPV: *${rt.pvPower}W*\nPin: *${rt.batterySoc}%* (${rt.batteryPower}W)\nTải: *${rt.loadPower}W*\nGrid: *${rt.gridPower}W* ${device.hasGridPower ? '🟢' : '🔴'}\nĐiện áp: *${rt.batteryVoltage}V*\nNhiệt độ: *${rt.temperature}°C*\n\n📈 *Hôm nay:*\nPV: ${de.pvDay}kWh\nTải: ${de.loadDay}kWh\nEVN: ${de.gridDay || 0}kWh\n\n🕐 ${getVietnamTime()}`, env);
}

async function handleSettings(chatId, args, devicesData, env) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `⚙️ *Cài đặt*\n\n_(Chưa có)_\n\n➕ /add`, env); return; }
  if (args.length === 0 && userDevices.length > 1) { let list = `🔔 *Thông báo*\n\nChọn:\n\n`; userDevices.forEach((d, i) => { list += `${i + 1}. \`${d.deviceId}\`\n`; }); list += `\n📝 Nhập số/ID:`; userStates.set(chatId, { waiting: 'settings_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list, env); return; }
  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy`, env); return; }
  const prefs = device.notifications || {};
  const getIcon = (val) => val ? '✅' : '❌';
  userStates.set(chatId, { waiting: 'settings_toggle', deviceId: device.deviceId });
  await sendTelegram(chatId, `🔔 *Thông báo* \`${device.deviceId}\`\n\n1️⃣ ${getIcon(prefs.morningGreeting)} Bắt đầu PV\n2️⃣ ${getIcon(prefs.pvEnded)} Hết PV\n3️⃣ ${getIcon(prefs.powerOutage)} Mất điện\n4️⃣ ${getIcon(prefs.powerRestored)} Có điện lại\n5️⃣ ${getIcon(prefs.lowBattery)} Pin yếu\n6️⃣ ${getIcon(prefs.hourlyStatus)} Mỗi giờ\n\n📝 Nhập 1-6 để bật/tắt, 0 thoát`, env);
}

async function handleLocation(chatId, args, devicesData, env) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📍 *Vùng*\n\n_(Chưa có)_\n\n➕ /add`, env); return; }
  let list = `📍 *Vùng thời tiết*\n\nChọn:\n\n`;
  userDevices.forEach((d, i) => { list += `${i + 1}. \`${d.deviceId}\` - ${d.location || "HCM"}\n`; });
  list += `\n📝 Nhập số:`;
  userStates.set(chatId, { waiting: 'location_select_device', devices: userDevices.map(d => ({ id: d.deviceId, location: d.location })) });
  await sendTelegram(chatId, list, env);
}


// ============================================
// 🔗 DEEP LINK HANDLER v2.6
// ============================================

async function handleStart(chatId, text, env, devicesData) {
  const payloadMatch = text.match(/\/start\s+(.+)/i);
  if (!payloadMatch) {
    await handleHelp(chatId, devicesData, env);
    return devicesData;
  }

  const payload = payloadMatch[1].trim();
  const alerts = await loadAllThresholdAlerts(env);

  // v2.4+ FORMAT: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_bvh_bvl_loc
  const shortMatchV2 = payload.match(/^add_([HP]\d+)_(\d{6})_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_([a-z]+)$/i);

  if (shortMatchV2) {
    const [, deviceId, notifBits, bf, bl, pv, gr, ld, vh, vl, locCode] = shortMatchV2;
    const notifications = parseNotificationBits(notifBits);
    const location = decodeLocationCode(locCode);
    const thresholds = {
      batteryFull: parseInt(bf),
      batteryLow: parseInt(bl),
      pvDaily: parseInt(pv),
      gridUsage: parseInt(gr),
      loadDaily: parseInt(ld),
      batteryVoltHigh: parseInt(vh) / 10,
      batteryVoltLow: parseInt(vl) / 10
    };

    const haDevices = await fetchAllDevicesFromHA(env);
    if (!haDevices.find(d => d.deviceId?.toUpperCase() === deviceId.toUpperCase())) {
      await sendTelegram(chatId, `❌ \`${deviceId.toUpperCase()}\` chưa có trong hệ thống`, env);
      return devicesData;
    }

    const result = await addDeviceWithSettings(env, devicesData, chatId, deviceId.toUpperCase(), notifications, location, thresholds, alerts);
    await saveAllThresholdAlerts(env, alerts);

    const action = result.isNew ? '✅ *ĐÃ THÊM THIẾT BỊ MỚI*' : '✅ *ĐÃ CẬP NHẬT THIẾT BỊ*';

    // Build notification status with checkmarks at FRONT
    const n = notifications;
    const getIcon = (val) => val ? '✅' : '❌';
    const notifStatus = `🔔 *Thông báo:*
${getIcon(n.morningGreeting)} ☀️ Bắt đầu PV
${getIcon(n.pvEnded)} 🌇 Hết PV
${getIcon(n.powerOutage)} ⚡ Mất điện
${getIcon(n.powerRestored)} 🔌 Có điện lại
${getIcon(n.lowBattery)} 🪫 Pin yếu
${getIcon(n.hourlyStatus)} ⏰ Báo cáo mỗi giờ`;

    // Build threshold status with checkmarks at FRONT
    const th = thresholds;
    const thresholdStatus = `🎯 *Ngưỡng cảnh báo:*
${th.batteryFull < 100 ? '✅' : '❌'} 🔋 Pin đầy: ${th.batteryFull}%
${th.batteryLow > 0 ? '✅' : '❌'} 🪫 Pin thấp: ${th.batteryLow}%
${th.batteryVoltHigh > 0 ? '✅' : '❌'} 🔌 Điện áp pin cao: ${th.batteryVoltHigh}V
${th.batteryVoltLow > 0 ? '✅' : '❌'} 🔌 Điện áp pin thấp: ${th.batteryVoltLow}V
${th.pvDaily > 0 ? '✅' : '❌'} ☀️ PV/ngày: ${th.pvDaily} kWh
${th.gridUsage > 0 ? '✅' : '❌'} ⚡ EVN/ngày: ${th.gridUsage} kWh
${th.loadDaily > 0 ? '✅' : '❌'} 🏠 Tiêu thụ/ngày: ${th.loadDaily} kWh`;

    const message = `${action}

📱 Device: \`${deviceId.toUpperCase()}\`
📍 Vùng: ${location}

${notifStatus}

${thresholdStatus}

✨ _Deep Link v2.9 đã được đồng bộ!_

⚙️ /settings - thay đổi thông báo
🎯 /thresholds - thay đổi ngưỡng
📍 /location - thay đổi vùng

🕐 ${getVietnamTime()}`;

    await sendTelegram(chatId, message, env);
    return result.devicesData;
  }

  // LEGACY v1.9.0 FORMAT: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_loc
  const shortMatch = payload.match(/^add_([HP]\d+)_(\d{6})_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_([a-z]+)$/i);

  if (shortMatch) {
    const [, deviceId, notifBits, bf, bl, pv, gr, ld, locCode] = shortMatch;
    const notifications = parseNotificationBits(notifBits);
    const location = decodeLocationCode(locCode);
    const thresholds = {
      batteryFull: parseInt(bf),
      batteryLow: parseInt(bl),
      pvDaily: parseInt(pv),
      gridUsage: parseInt(gr),
      loadDaily: parseInt(ld),
      batteryVoltHigh: 0,
      batteryVoltLow: 0
    };

    const haDevices = await fetchAllDevicesFromHA(env);
    if (!haDevices.find(d => d.deviceId?.toUpperCase() === deviceId.toUpperCase())) {
      await sendTelegram(chatId, `❌ \`${deviceId.toUpperCase()}\` chưa có trong hệ thống`, env);
      return devicesData;
    }

    const result = await addDeviceWithSettings(env, devicesData, chatId, deviceId.toUpperCase(), notifications, location, thresholds, alerts);
    await saveAllThresholdAlerts(env, alerts);

    const action = result.isNew ? '✅ *ĐÃ THÊM THIẾT BỊ MỚI*' : '✅ *ĐÃ CẬP NHẬT THIẾT BỊ*';

    // Build notification status with checkmarks at FRONT
    const n = notifications;
    const getIcon = (val) => val ? '✅' : '❌';
    const notifStatus = `🔔 *Thông báo:*
${getIcon(n.morningGreeting)} ☀️ Bắt đầu PV
${getIcon(n.pvEnded)} 🌇 Hết PV
${getIcon(n.powerOutage)} ⚡ Mất điện
${getIcon(n.powerRestored)} 🔌 Có điện lại
${getIcon(n.lowBattery)} 🪫 Pin yếu
${getIcon(n.hourlyStatus)} ⏰ Báo cáo mỗi giờ`;

    // Build threshold status with checkmarks at FRONT
    const th = thresholds;
    const thresholdStatus = `🎯 *Ngưỡng cảnh báo:*
${th.batteryFull < 100 ? '✅' : '❌'} 🔋 Pin đầy: ${th.batteryFull}%
${th.batteryLow > 0 ? '✅' : '❌'} 🪫 Pin thấp: ${th.batteryLow}%
${th.pvDaily > 0 ? '✅' : '❌'} ☀️ PV/ngày: ${th.pvDaily} kWh
${th.gridUsage > 0 ? '✅' : '❌'} ⚡ EVN/ngày: ${th.gridUsage} kWh
${th.loadDaily > 0 ? '✅' : '❌'} 🏠 Tiêu thụ/ngày: ${th.loadDaily} kWh`;

    const message = `${action}

📱 Device: \`${deviceId.toUpperCase()}\`
📍 Vùng: ${location}

${notifStatus}

${thresholdStatus}

✨ _Deep Link v1.9 đã được đồng bộ!_

⚙️ /settings - thay đổi thông báo
🎯 /thresholds - thay đổi ngưỡng
📍 /location - thay đổi vùng

🕐 ${getVietnamTime()}`;

    await sendTelegram(chatId, message, env);
    return result.devicesData;
  }

  // Simple format: add_DEVICEID
  const addMatch = payload.match(/^add_([HP]\d+)/i);

  if (addMatch) {
    const deviceId = addMatch[1].toUpperCase();

    const haDevices = await fetchAllDevicesFromHA(env);
    if (!haDevices.find(d => d.deviceId?.toUpperCase() === deviceId)) {
      await sendTelegram(chatId, `❌ \`${deviceId}\` chưa có trong hệ thống`, env);
      return devicesData;
    }

    const result = await addDevice(env, devicesData, chatId, deviceId);

    const action = result.success ? '✅ *THÊM MỚI*' : 'ℹ️ *ĐÃ CÓ*';
    await sendTelegram(chatId, `${action}\n\n📱 \`${deviceId}\`\n\n⚙️ /settings /thresholds /location`, env);
    return result.devicesData;
  }

  await handleHelp(chatId, devicesData, env);
  return devicesData;
}

// ============================================
// 💬 CONVERSATION HANDLER
// ============================================

async function handleConversation(chatId, text, env, devicesData) {
  const state = userStates.get(chatId);
  if (!state) return { handled: false, devicesData };
  userStates.delete(chatId);
  const alerts = await loadAllThresholdAlerts(env);

  switch (state.waiting) {
    case 'add_device': return { handled: true, devicesData: await handleAdd(chatId, [text], env, devicesData) };
    case 'remove_device':
      let deviceId = text;
      if (/^\d+$/.test(text) && state.devices) { const idx = parseInt(text) - 1; if (idx >= 0 && idx < state.devices.length) deviceId = state.devices[idx]; }
      return { handled: true, devicesData: await handleRemove(chatId, [deviceId], env, devicesData) };
    case 'check_device': await handleCheck(chatId, [text], env); return { handled: true, devicesData };
    case 'settings_device':
      let selectedDevice = text;
      if (/^\d+$/.test(text) && state.devices) { const idx = parseInt(text) - 1; if (idx >= 0 && idx < state.devices.length) selectedDevice = state.devices[idx]; }
      await handleSettings(chatId, [selectedDevice], devicesData, env);
      return { handled: true, devicesData };
    case 'settings_toggle':
      if (text === '0') { await sendTelegram(chatId, `🚪 Thoát`, env); return { handled: true, devicesData }; }
      const settingNum = parseInt(text);
      if (settingNum >= 1 && settingNum <= 6) {
        const result = await updateDeviceSettings(env, devicesData, chatId, state.deviceId, settingNum);
        if (result) {
          const settingNames = { morningGreeting: "Chào buổi sáng", powerOutage: "Mất điện", powerRestored: "Có điện lại", lowBattery: "Pin yếu", pvEnded: "Hết PV", hourlyStatus: "Mỗi giờ" };
          await sendTelegram(chatId, `✅ ${settingNames[result.setting]}: ${result.newValue ? "BẬT" : "TẮT"}\n\n📝 Tiếp tục (1-6) hoặc 0 thoát`, env);
          userStates.set(chatId, { waiting: 'settings_toggle', deviceId: state.deviceId });
        }
      } else {
        await sendTelegram(chatId, `❌ Nhập 1-6 hoặc 0`, env);
        userStates.set(chatId, state);
      }
      return { handled: true, devicesData };

    case 'thresholds_device':
      const thDevIdx = parseInt(text) - 1;
      if (thDevIdx >= 0 && thDevIdx < state.devices.length) {
        await handleThresholds(chatId, [state.devices[thDevIdx]], devicesData, env);
      } else {
        await sendTelegram(chatId, `❌ Không hợp lệ. /thresholds`, env);
      }
      return { handled: true, devicesData };

    case 'thresholds_select':
      if (text === '0') { await sendTelegram(chatId, `🚪 Thoát`, env); return { handled: true, devicesData }; }
      const thNum = parseInt(text);
      if (thNum >= 1 && thNum <= 7) {
        const thNames = { 1: 'batteryFull', 2: 'batteryLow', 3: 'batteryVoltHigh', 4: 'batteryVoltLow', 5: 'pvDaily', 6: 'gridUsage', 7: 'loadDaily' };
        const thLabels = { 1: 'Pin đầy (%)', 2: 'Pin thấp (%)', 3: 'Điện áp cao (V)', 4: 'Điện áp thấp (V)', 5: 'PV/ngày (kWh)', 6: 'EVN/ngày (kWh)', 7: 'Tiêu thụ/ngày (kWh)' };
        userStates.set(chatId, { waiting: 'thresholds_input', deviceId: state.deviceId, thresholdKey: thNames[thNum] });
        await sendTelegram(chatId, `*${thLabels[thNum]}*\n\n📝 Nhập giá trị (0 = TẮT):`, env);
      } else {
        await sendTelegram(chatId, `❌ Nhập 1-7 hoặc 0`, env);
        userStates.set(chatId, state);
      }
      return { handled: true, devicesData };

    case 'thresholds_input':
      const isVoltageType = ['batteryVoltHigh', 'batteryVoltLow'].includes(state.thresholdKey);
      const normalizedText = text.replace(',', '.');
      const value = isVoltageType ? parseFloat(normalizedText) : parseInt(normalizedText);
      if (isNaN(value) || value < 0) {
        await sendTelegram(chatId, `❌ Giá trị không hợp lệ (≥0)`, env);
        userStates.set(chatId, state);
        return { handled: true, devicesData };
      }
      const newTh = { [state.thresholdKey]: value };
      await updateDeviceThresholds(env, devicesData, chatId, state.deviceId, newTh, alerts);
      await saveAllThresholdAlerts(env, alerts);
      const thLabelMap = { batteryFull: 'Pin đầy', batteryLow: 'Pin thấp', pvDaily: 'PV/ngày', gridUsage: 'EVN/ngày', loadDaily: 'Tiêu thụ/ngày', batteryVoltHigh: 'Điện áp cao', batteryVoltLow: 'Điện áp thấp' };
      const unitMap = { batteryFull: '%', batteryLow: '%', pvDaily: 'kWh', gridUsage: 'kWh', loadDaily: 'kWh', batteryVoltHigh: 'V', batteryVoltLow: 'V' };
      await sendTelegram(chatId, `✅ ${thLabelMap[state.thresholdKey]}: *${value}${unitMap[state.thresholdKey]}*\n\n⚙️ /thresholds`, env);
      return { handled: true, devicesData };

    case 'location_select_device':
      const devIdx = parseInt(text) - 1;
      if (devIdx >= 0 && devIdx < state.devices.length) {
        const selectedDev = state.devices[devIdx];
        userStates.set(chatId, { waiting: 'location_select_region', deviceId: selectedDev.id, currentLocation: selectedDev.location });
        await sendTelegram(chatId, `📱 \`${selectedDev.id}\`\n\n1️⃣ Miền Nam\n2️⃣ Miền Trung\n3️⃣ Tây Nguyên\n4️⃣ Miền Bắc\n\n📝 Nhập 1-4:`, env);
      } else {
        await sendTelegram(chatId, `❌ Không hợp lệ. /location`, env);
      }
      return { handled: true, devicesData };

    case 'location_select_region':
      const regionNum = parseInt(text);
      if (regionNum >= 1 && regionNum <= 4) {
        const regionMap = { 1: "Mien Nam", 2: "Mien Trung", 3: "Tay Nguyen", 4: "Mien Bac" };
        const regionNames = { 1: "Miền Nam", 2: "Miền Trung", 3: "Tây Nguyên", 4: "Miền Bắc" };
        const region = regionMap[regionNum];
        const cities = Object.entries(VIETNAM_CITIES).filter(([_, d]) => d.region === region).map(([name]) => name).sort();
        let message = `🌴 *${regionNames[regionNum]}*\n\n`;
        cities.forEach((city, i) => { message += `${i + 1}. ${city}\n`; });
        message += `\n📝 Nhập số (1-${cities.length}):`;
        userStates.set(chatId, { waiting: 'location_select_city', deviceId: state.deviceId, cities });
        await sendTelegram(chatId, message, env);
      } else {
        await sendTelegram(chatId, `❌ Nhập 1-4`, env);
        userStates.set(chatId, state);
      }
      return { handled: true, devicesData };

    case 'location_select_city':
      let selectedCity = null;
      if (/^\d+$/.test(text) && state.cities) { const idx = parseInt(text) - 1; if (idx >= 0 && idx < state.cities.length) selectedCity = state.cities[idx]; }
      else { selectedCity = Object.keys(VIETNAM_CITIES).find(c => c.toLowerCase().includes(text.toLowerCase())); }
      if (selectedCity && VIETNAM_CITIES[selectedCity]) {
        await updateSingleDeviceLocation(env, devicesData, chatId, state.deviceId, selectedCity);
        await sendTelegram(chatId, `✅ \`${state.deviceId}\` → *${selectedCity}*`, env);
      } else {
        await sendTelegram(chatId, `❌ Không tìm thấy. /location`, env);
      }
      return { handled: true, devicesData };
  }
  return { handled: false, devicesData };
}


// ============================================
// 🔄 UPDATE HANDLER
// ============================================

async function handleUpdate(update, env) {
  if (!update.message?.text) return;
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  let devicesData = await loadDevicesData(env);

  if (!text.startsWith('/')) {
    await handleConversation(chatId, text, env, devicesData);
    return;
  }

  userStates.delete(chatId);
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().split('@')[0];
  const args = parts.slice(1);

  switch (command) {
    case '/start': await handleStart(chatId, text, env, devicesData); break;
    case '/help': await handleHelp(chatId, devicesData, env); break;
    case '/add': await handleAdd(chatId, args, env, devicesData); break;
    case '/remove': case '/delete': await handleRemove(chatId, args, env, devicesData); break;
    case '/list': await handleList(chatId, devicesData, env); break;
    case '/status': await handleStatus(chatId, env, devicesData); break;
    case '/check': await handleCheck(chatId, args, env); break;
    case '/settings': case '/caidat': await handleSettings(chatId, args, devicesData, env); break;
    case '/thresholds': case '/nguong': await handleThresholds(chatId, args, devicesData, env); break;
    case '/location': case '/vung': case '/vitri': await handleLocation(chatId, args, devicesData, env); break;
    default: await sendTelegram(chatId, `❓ Lệnh không hợp lệ. /help`, env);
  }
}

// ============================================
// 🌐 CLOUDFLARE WORKER EXPORT
// ============================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return corsResponse(null, { status: 204 });

    // Get bot token from env or default
    const token = env.BOT_TOKEN || BOT_TOKEN;
    const telegramApi = 'https://api.telegram.org/bot' + token;

    // ============================================
    // 🔧 WEBHOOK SETUP
    // ============================================
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = url.origin + '/webhook';
      const webhookResp = await fetch(telegramApi + '/setWebhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const commands = [
        { command: 'start', description: '🚀 Bắt đầu' },
        { command: 'help', description: '📋 Hướng dẫn' },
        { command: 'add', description: '📱 Thêm thiết bị' },
        { command: 'remove', description: '🗑️ Xóa thiết bị' },
        { command: 'list', description: '📋 Danh sách' },
        { command: 'status', description: '📊 Trạng thái' },
        { command: 'check', description: '🔍 Kiểm tra' },
        { command: 'settings', description: '🔔 Thông báo' },
        { command: 'thresholds', description: '🎯 Ngưỡng' },
        { command: 'location', description: '📍 Vùng' }
      ];
      const cmdResp = await fetch(telegramApi + '/setMyCommands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands })
      });
      return jsonResponse({ webhook: await webhookResp.json(), commands: await cmdResp.json(), webhookUrl });
    }

    // ============================================
    // 📩 WEBHOOK HANDLER
    // ============================================
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        ctx.waitUntil(handleUpdate(await request.json(), env));
        return corsResponse('OK');
      } catch (e) {
        return corsResponse('Error', { status: 500 });
      }
    }

    // ============================================
    // 🧪 TEST & DEBUG ENDPOINTS
    // ============================================
    if (url.pathname === '/test-api') {
      const devices = await fetchAllDevicesFromHA(env);
      return jsonResponse({
        success: true,
        source: 'Direct_HA',
        count: devices.length,
        deviceIds: devices.map(d => d.deviceId) // Show ALL device IDs
      });
    }

    // 🔍 DEBUG SYNC - Show detailed device matching info
    if (url.pathname === '/debug-sync') {
      const devicesData = await loadDevicesData(env);
      const haDevices = await fetchAllDevicesFromHA(env);

      const registeredIds = new Set(devicesData.map(d => d.deviceId.toUpperCase()));
      const haIds = new Set(haDevices.map(d => d.deviceId.toUpperCase()));

      // Find mismatches
      const registeredNotInHA = [...registeredIds].filter(id => !haIds.has(id));
      const haNotRegistered = [...haIds].filter(id => !registeredIds.has(id));
      const matched = [...registeredIds].filter(id => haIds.has(id));

      return jsonResponse({
        success: true,
        summary: {
          registeredUsers: devicesData.length,
          uniqueRegisteredDevices: registeredIds.size,
          haDevicesTotal: haDevices.length,
          matchedDevices: matched.length,
          registeredButNotInHA: registeredNotInHA.length,
          inHAButNotRegistered: haNotRegistered.length
        },
        details: {
          matchedDevices: matched,
          registeredButNotInHA: registeredNotInHA,
          inHAButNotRegistered: haNotRegistered.slice(0, 20) // Limit to 20
        },
        timestamp: getVietnamTime()
      });
    }

    if (url.pathname === '/trigger-notifications') {
      return jsonResponse({
        success: true,
        ...(await processNotifications(env)),
        timestamp: getVietnamTime()
      });
    }

    // 🧪 TEST SEND - Send test notification to specific device
    if (url.pathname === '/test-send') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required. Usage: /test-send?deviceId=P250801055' });

      // Get device data from KV
      const devicesData = await loadDevicesData(env);
      const userDevice = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      if (!userDevice) return jsonResponse({ success: false, error: `Device ${deviceId} not registered in bot` });

      // Get device from HA
      const haDevices = await fetchAllDevicesFromHA(env);
      const haDevice = haDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      if (!haDevice) return jsonResponse({
        success: false,
        error: `Device ${deviceId} not found in Home Assistant`,
        haDeviceCount: haDevices.length,
        registeredDevice: { deviceId: userDevice.deviceId, chatId: userDevice.chatId, location: userDevice.location }
      });

      // Get weather and build message
      const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
      const rt = haDevice.realtime;
      const de = haDevice.dailyEnergy;
      const vnHour = getVietnamHour();
      const template = getHourlyTemplate(vnHour, weather);
      const weatherTip = getWeatherTip(weather, rt.pvPower);
      const locationName = userDevice.location || 'TP. Ho Chi Minh';

      let pvTip = '';
      if (rt.pvPower > 1000) pvTip = '\n\n🔥 _PV đang "cháy" hết công suất!_';
      else if (rt.pvPower > 500) pvTip = '\n\n⚡ _PV đang hoạt động mạnh mẽ!_';
      else if (rt.pvPower > 100) pvTip = '\n\n💡 _PV đang thu nạp năng lượng!_';
      else if (vnHour < 17 && vnHour >= 6) pvTip = '\n\n💡 _Chờ nắng lên để PV hoạt động_';
      else pvTip = '\n\n🌙 _PV nghỉ ngơi, pin đảm nhận!_';

      let weatherInfo = '';
      if (weather) {
        weatherInfo = `\n\n🌤️ *Thời tiết ${locationName}:*\n${weather.icon} ${weather.currentDescription}\n🌡️ Nhiệt độ: ${weather.currentTemp}°C | 💧 Độ ẩm: ${weather.humidity}% | 💨 Gió: ${weather.windSpeed} km/h\n☀️ UV: ${weather.uvIndex} | 🌧️ Mưa: ${weather.rainChance}%\n\n${weatherTip}`;
      }

      const message = `🧪 *TEST NOTIFICATION*\n${template.emoji} *${template.label}*\n${template.greeting}\n\n📱 *${deviceId.toUpperCase()}*\n☀️ PV: *${rt.pvPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* ${getBatteryFunStatus(rt.batterySoc)}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}\n🔋 Voltage: *${rt.batteryVoltage}V*${weatherInfo}${pvTip}\n\n📊 *Hôm nay:*\nPV: ${de.pvDay}kWh | Load: ${de.loadDay}kWh | EVN: ${de.gridDay || 0}kWh\n\n🕐 ${getVietnamTime()}`;

      // Send to Telegram using debug version for full response
      const result = await sendTelegramDebug(userDevice.chatId, message, env);

      return jsonResponse({
        success: result.sent,
        deviceId: deviceId.toUpperCase(),
        chatId: userDevice.chatId,
        location: locationName,
        weather: weather ? { temp: weather.currentTemp, humidity: weather.humidity, rain: weather.rainChance, uv: weather.uvIndex } : null,
        realtime: rt,
        dailyEnergy: de,
        messageSent: result.sent,
        telegramResponse: result.response || result.error,
        timestamp: getVietnamTime()
      });
    }

    // ============================================
    // 📱 DEVICE SETTINGS API
    // ============================================
    if (url.pathname === '/api/device-settings') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });
      const devicesData = await loadDevicesData(env);
      const device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      if (!device) return jsonResponse({ success: false, error: 'Device not found', deviceId });
      return jsonResponse({
        success: true,
        deviceId: device.deviceId,
        location: device.location,
        settings: device.notifications,
        thresholds: device.thresholds || DEFAULT_THRESHOLDS,
        addedAt: device.addedAt
      });
    }

    if (url.pathname === '/api/update-settings' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { deviceId, notifications, location, thresholds, chatId } = body;
        if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });

        let devicesData = await loadDevicesData(env);
        let device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
        const alerts = await loadAllThresholdAlerts(env);

        if (!device && chatId) {
          device = {
            deviceId: deviceId.toUpperCase(),
            chatId: parseInt(chatId),
            addedAt: getVietnamTime(),
            location: location || "TP. Ho Chi Minh",
            notifications: notifications || { morningGreeting: true, powerOutage: true, powerRestored: true, lowBattery: true, pvEnded: true, hourlyStatus: false },
            thresholds: thresholds || { ...DEFAULT_THRESHOLDS }
          };
          devicesData.push(device);
        } else if (!device) {
          return jsonResponse({ success: false, error: 'Device not found' });
        }

        if (notifications) device.notifications = { ...device.notifications, ...notifications };
        if (location) device.location = location;
        if (thresholds) {
          const oldThresholds = device.thresholds || { ...DEFAULT_THRESHOLDS };
          device.thresholds = { ...oldThresholds, ...thresholds };
          clearAllThresholdAlertsForDevice(alerts, device.chatId, device.deviceId.toUpperCase());
          await saveAllThresholdAlerts(env, alerts);
        }

        await saveDevicesData(env, devicesData);
        return jsonResponse({
          success: true,
          message: 'Updated',
          deviceId: device.deviceId,
          notifications: device.notifications,
          location: device.location,
          thresholds: device.thresholds,
          thresholdsReset: !!thresholds
        });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message });
      }
    }

    // ============================================
    // 🔗 DEEP LINK GENERATOR API
    // ============================================
    if (url.pathname === '/api/generate-deeplink') {
      const deviceId = url.searchParams.get('deviceId');
      const notifs = url.searchParams.get('notifications') || '111110';
      const bf = url.searchParams.get('bf') || '100';
      const bl = url.searchParams.get('bl') || '20';
      const pv = url.searchParams.get('pv') || '0';
      const gr = url.searchParams.get('gr') || '0';
      const ld = url.searchParams.get('ld') || '0';
      const vh = url.searchParams.get('vh') || '0';
      const vl = url.searchParams.get('vl') || '0';
      const loc = url.searchParams.get('loc') || 'hcm';

      if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });

      const shortLink = `add_${deviceId.toUpperCase()}_${notifs}_${bf}_${bl}_${pv}_${gr}_${ld}_${vh}_${vl}_${loc}`;
      const telegramUrl = `https://t.me/LightEarthBot?start=${shortLink}`;

      return jsonResponse({
        success: true,
        shortLink,
        telegramUrl,
        length: shortLink.length,
        maxLength: 64,
        valid: shortLink.length <= 64
      });
    }

    // ============================================
    // 🌤️ WEATHER TEST
    // ============================================
    if (url.pathname === '/test-weather') {
      const location = url.searchParams.get('location') || 'TP. Ho Chi Minh';
      try {
        const weather = await getWeather(location);
        return jsonResponse({ success: !!weather, location, weather: weather || 'Failed', timestamp: getVietnamTime() });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message, location });
      }
    }

    // ============================================
    // 📦 KV STATUS & BACKUP
    // ============================================
    if (url.pathname === '/kv-status') {
      const hasKV = !!env.BOT_KV;
      let count = 0, states = null;
      if (hasKV) {
        try {
          const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' });
          states = await env.BOT_KV.get(KV_KEYS.DEVICE_STATES, { type: 'json' });
          count = data?.length || 0;
        } catch (e) { }
      }
      return jsonResponse({ kvBound: hasKV, usersCount: count, statesTracked: states ? Object.keys(states).length : 0, message: hasKV ? 'KV active' : 'KV not bound' });
    }

    if (url.pathname === '/kv-backup') {
      if (!env.BOT_KV) return jsonResponse({ error: 'KV not bound' }, 400);
      return jsonResponse({ backup: await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }), timestamp: new Date().toISOString() });
    }

    // ============================================
    // ❤️ HEALTH CHECK
    // ============================================
    if (url.pathname === '/health') {
      const hasKV = !!env.BOT_KV;
      let count = 0;
      if (hasKV) {
        const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' });
        count = data?.length || 0;
      }
      return jsonResponse({
        status: 'ok',
        version: '2.7',
        features: [
          'Compact Notifications',
          'Voltage Alerts',
          'Short Deep Link ≤64',
          'Smart Thresholds',
          'Alert Once',
          'Weather Cache',
          'Batch KV'
        ],
        mode: 'Direct_HA',
        storage: hasKV ? 'KV_Persistent' : 'In-Memory',
        notifications: 'enabled',
        webAPI: 'enabled',
        users: count
      });
    }

    // ============================================
    // 🏠 DEFAULT HTML PAGE
    // ============================================
    return corsResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LightEarth Bot v2.7</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0f172a;color:#e2e8f0}h1{color:#22d3ee}h2{color:#a78bfa;border-bottom:1px solid #334155;padding-bottom:10px}ul{list-style:none;padding-left:0}li{padding:8px 0;border-bottom:1px solid #1e293b}a{color:#22d3ee;text-decoration:none}.badge{background:#059669;color:white;padding:3px 8px;border-radius:4px;font-size:12px;margin-right:5px}.code{background:#1e293b;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:13px;display:block;margin:10px 0}</style></head><body><h1>🤖 LightEarth Bot v2.7</h1><p><span class="badge">📋 Compact</span><span class="badge">⚡ Voltage</span><span class="badge">🔗 Deep Link</span></p><h2>📋 Thông báo gọn v2.6:</h2><p>✅ Pin đầy: 97%<br>⚠️ Pin thấp: 20%<br>🔴 Điện áp cao: 54.5V<br>🟡 Điện áp thấp: 51V<br>☀️ Sản lượng PV: 25kWh<br>⚡ Điện EVN: 25kWh<br>🏠 Tiêu thụ: 25kWh</p><h2>📱 Commands:</h2><ul><li>/status - Trạng thái</li><li>/check - Kiểm tra chi tiết</li><li>/settings - Thông báo</li><li>/thresholds - Ngưỡng</li><li>/location - Vùng</li></ul><h2>🔧 API:</h2><ul><li><a href="/health">/health</a></li><li><a href="/trigger-notifications">/trigger-notifications</a></li><li><a href="/kv-status">/kv-status</a></li></ul></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },

  // ============================================
  // ⏰ CRON TRIGGER
  // ============================================
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processNotifications(env));
  }
};
