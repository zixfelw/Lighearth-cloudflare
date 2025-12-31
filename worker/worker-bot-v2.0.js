// LightEarth Telegram Bot - Cloudflare Worker with KV Storage
// Version: 2.0 - VOLTAGE ALERTS + ULTRA SHORT DEEP LINK
// 
// NEW IN v2.0:
// - ⚡ Voltage Alerts: voltageHigh (quá áp) and voltageLow (thấp áp)
// - 🔔 Alert Once: chỉ báo 1 lần/ngày/ngưỡng, reset lúc 00:00 VN
// - 🔗 Extended Deep Link: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_vh_vl_loc
//
// FIXED: Telegram start_param max 64 chars
// OLD: add_P250802210_mg_po_pr_lb_pe_hs_loc_TP_Ho_Chi_Minh_bf100_bl20_pv0_gr0_ld0 (75 chars) ❌
// NEW: add_P250802210_111110_95_20_10_5_15_260_180_hcm (52 chars) ✅
//
// SHORT FORMAT: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_vh_vl_loc
// - NNNNNN: 6 bits for notifications (1=on, 0=off)
//   - Bit 1: morningGreeting (mg)
//   - Bit 2: powerOutage (po)
//   - Bit 3: powerRestored (pr)
//   - Bit 4: lowBattery (lb)
//   - Bit 5: pvEnded (pe)
//   - Bit 6: hourlyStatus (hs)
// - bf_bl_pv_gr_ld_vh_vl: compact threshold numbers
//   - bf: batteryFull (%)
//   - bl: batteryLow (%)
//   - pv: pvDaily (kWh)
//   - gr: gridUsage (kWh)
//   - ld: loadDaily (kWh)
//   - vh: voltageHigh (V) - 0 = TẮT
//   - vl: voltageLow (V) - 0 = TẮT
// - loc: 2-4 char location code (hcm, hn, dng, tn, etc.)
//
// IMPORTANT: Set up in Cloudflare Dashboard:
// 1. Environment Variables: PI_URL, PI_TOKEN
// 2. KV Namespace Binding: BOT_KV
// 3. Cron Trigger: every 5 minutes

const BOT_TOKEN = '8471250396:AAGFvYBxwzmYQeivR0tBUPrDoqHHNnsfwdU';
const TELEGRAM_API = 'https://api.telegram.org/bot' + BOT_TOKEN;

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

const KV_KEYS = { DEVICES: 'devices_data', DEVICE_STATES: 'device_states' };

const DEFAULT_THRESHOLDS = {
  batteryFull: 100,
  batteryLow: 20,
  pvDaily: 0,
  gridUsage: 0,
  loadDaily: 0,
  voltageHigh: 0,  // 0 = TẮT, VD: 260V
  voltageLow: 0    // 0 = TẮT, VD: 180V
};

const DEFAULT_DEVICES_DATA = [
  {"deviceId":"P250802210","chatId":5403648143,"addedAt":"2025-12-26 07:46:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"P250801055","chatId":273383744,"addedAt":"2025-12-23 20:28:53","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"P250716712","chatId":6881006811,"addedAt":"2025-12-24 09:11:07","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"H241228031","chatId":6547314159,"addedAt":"2025-12-23 20:55:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"P250802171","chatId":5403648143,"addedAt":"2025-12-26 07:42:13","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"H250422132","chatId":273383744,"addedAt":"2025-12-23 21:08:29","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"P240522014","chatId":273383744,"addedAt":"2025-12-23 21:00:40","location":"Tay Ninh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}},
  {"deviceId":"H250411103","chatId":273383744,"addedAt":"2025-12-24 17:49:28","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false},"thresholds":{"batteryFull":100,"batteryLow":20,"pvDaily":0,"gridUsage":0,"loadDaily":0}}
];

async function loadDevicesData(env) {
  if (!env.BOT_KV) return [...DEFAULT_DEVICES_DATA];
  try {
    const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' });
    if (data && Array.isArray(data)) {
      data.forEach(d => { if (!d.thresholds) d.thresholds = { ...DEFAULT_THRESHOLDS }; });
      return data;
    }
    await env.BOT_KV.put(KV_KEYS.DEVICES, JSON.stringify(DEFAULT_DEVICES_DATA));
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

async function getThresholdAlertKey(env, type, chatId, deviceId) {
  if (!env.BOT_KV) return null;
  const key = `th_${type}_${chatId}_${deviceId}`;
  try { return await env.BOT_KV.get(key); } catch (e) { return null; }
}

async function setThresholdAlertKey(env, type, chatId, deviceId, thresholdValue) {
  if (!env.BOT_KV) return false;
  const key = `th_${type}_${chatId}_${deviceId}`;
  try { await env.BOT_KV.put(key, String(thresholdValue), { expirationTtl: 86400 }); return true; } catch (e) { return false; }
}

async function clearThresholdAlertKey(env, type, chatId, deviceId) {
  if (!env.BOT_KV) return false;
  const key = `th_${type}_${chatId}_${deviceId}`;
  try { await env.BOT_KV.delete(key); return true; } catch (e) { return false; }
}

async function clearAllThresholdAlerts(env, chatId, deviceId) {
  const types = ['full', 'low', 'pv', 'grid', 'load', 'vhigh', 'vlow'];
  for (const type of types) { await clearThresholdAlertKey(env, type, chatId, deviceId); }
}

const userStates = new Map();

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
// SHORT LOCATION CODES - v1.9.0
// ============================================
const LOCATION_CODES = {
  'hcm': 'TP. Ho Chi Minh',
  'hn': 'Ha Noi',
  'dng': 'Da Nang',
  'ct': 'Can Tho',
  'bd': 'Binh Duong',
  'tn': 'Tay Ninh',
  'dn': 'Dong Nai',
  'dl': 'Lam Dong',
  'la': 'Long An',
  'tg': 'Tien Giang',
  'bt': 'Ben Tre',
  'vl': 'Vinh Long',
  'tv': 'Tra Vinh',
  'dt': 'Dong Thap',
  'ag': 'An Giang',
  'kg': 'Kien Giang',
  'hg': 'Hau Giang',
  'st': 'Soc Trang',
  'bl': 'Bac Lieu',
  'cm': 'Ca Mau',
  'brvt': 'Ba Ria - Vung Tau',
  'bp': 'Binh Phuoc',
  'tth': 'Thua Thien Hue',
  'qna': 'Quang Nam',
  'qng': 'Quang Ngai',
  'bdi': 'Binh Dinh',
  'py': 'Phu Yen',
  'kh': 'Khanh Hoa',
  'nt': 'Ninh Thuan',
  'bth': 'Binh Thuan',
  'qb': 'Quang Binh',
  'qt': 'Quang Tri',
  'hti': 'Ha Tinh',
  'na': 'Nghe An',
  'th': 'Thanh Hoa',
  'kt': 'Kon Tum',
  'gl': 'Gia Lai',
  'dlk': 'Dak Lak',
  'dno': 'Dak Nong',
  'hp': 'Hai Phong',
  'qni': 'Quang Ninh',
  'bg': 'Bac Giang',
  'bn': 'Bac Ninh',
  'hdu': 'Hai Duong',
  'hy': 'Hung Yen',
  'tb': 'Thai Binh',
  'nd': 'Nam Dinh',
  'nb': 'Ninh Binh',
  'hna': 'Ha Nam',
  'vp': 'Vinh Phuc',
  'pt': 'Phu Tho',
  'tnu': 'Thai Nguyen',
  'bk': 'Bac Kan',
  'cb': 'Cao Bang',
  'ls': 'Lang Son',
  'tqu': 'Tuyen Quang',
  'hgi': 'Ha Giang',
  'yb': 'Yen Bai',
  'lc': 'Lao Cai',
  'lch': 'Lai Chau',
  'db': 'Dien Bien',
  'sla': 'Son La',
  'hbi': 'Hoa Binh'
};

// Decode short location code to full city name
function decodeLocationCode(code) {
  if (!code) return "TP. Ho Chi Minh";
  const lowerCode = code.toLowerCase();
  if (LOCATION_CODES[lowerCode]) return LOCATION_CODES[lowerCode];
  
  // Try to match partial codes
  for (const [short, full] of Object.entries(LOCATION_CODES)) {
    if (lowerCode.includes(short) || short.includes(lowerCode)) return full;
  }
  
  // Fallback to old method
  const decoded = code.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  for (const city of Object.keys(VIETNAM_CITIES)) {
    if (city.toLowerCase().replace(/[^a-z0-9]/g, '') === decoded.toLowerCase().replace(/[^a-z0-9]/g, '')) return city;
    if (decoded.toLowerCase().includes(city.toLowerCase().replace(/[^a-z]/g, ''))) return city;
  }
  for (const city of Object.keys(VIETNAM_CITIES)) {
    const cityNorm = city.toLowerCase().replace(/[^a-z]/g, '');
    const decodedNorm = decoded.toLowerCase().replace(/[^a-z]/g, '');
    if (cityNorm.includes(decodedNorm) || decodedNorm.includes(cityNorm)) return city;
  }
  return "TP. Ho Chi Minh";
}

// Encode city name to short location code
function encodeLocationCode(cityName) {
  if (!cityName) return 'hcm';
  for (const [code, name] of Object.entries(LOCATION_CODES)) {
    if (name === cityName) return code;
  }
  return 'hcm';
}

// Parse notification bits (6 bits string like "111110")
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

// Encode notifications to bits string
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

function getVietnamTime() { return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', ''); }
function getVietnamHour() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours(); }
function getVietnamDate() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0]; }

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

function getUserDevices(devicesData, chatId) { return devicesData.filter(d => d.chatId === chatId); }

async function addDeviceWithSettings(env, devicesData, chatId, deviceId, notifications, location, thresholds) {
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
    await clearAllThresholdAlerts(env, chatId, upperDeviceId);
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

async function removeDevice(env, devicesData, chatId, deviceId) {
  const index = devicesData.findIndex(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (index === -1) return { success: false, devicesData };
  await clearAllThresholdAlerts(env, chatId, deviceId.toUpperCase());
  devicesData.splice(index, 1);
  await saveDevicesData(env, devicesData);
  return { success: true, devicesData };
}

async function updateDeviceSettings(env, devicesData, chatId, deviceId, settingNum) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device || !device.notifications) return null;
  const settingMap = { 1: 'morningGreeting', 2: 'powerOutage', 3: 'powerRestored', 4: 'lowBattery', 5: 'pvEnded', 6: 'hourlyStatus' };
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

async function updateDeviceThresholds(env, devicesData, chatId, deviceId, newThresholds) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) return false;
  const oldThresholds = device.thresholds || { ...DEFAULT_THRESHOLDS };
  device.thresholds = { ...oldThresholds, ...newThresholds };
  await clearAllThresholdAlerts(env, chatId, deviceId.toUpperCase());
  await saveDevicesData(env, devicesData);
  return true;
}

async function fetchAllDevicesFromHA(env) {
  const PI_URL = env.PI_URL || env.HA_URL;
  const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN;
  if (!PI_URL || !PI_TOKEN) return [];
  try {
    const response = await fetch(`${PI_URL}/api/states`, { headers: { 'Authorization': `Bearer ${PI_TOKEN}`, 'Content-Type': 'application/json' } });
    if (!response.ok) return [];
    const states = await response.json();
    const deviceIds = new Set();
    states.forEach(state => { const match = state.entity_id.match(/^sensor\.device_([a-z0-9]+)_/i); if (match) deviceIds.add(match[1].toUpperCase()); });
    const devices = [];
    for (const deviceId of deviceIds) {
      const devicePrefix = `sensor.device_${deviceId.toLowerCase()}_`;
      const binaryPrefix = `binary_sensor.device_${deviceId.toLowerCase()}_`;
      const deviceStates = states.filter(s => s.entity_id.startsWith(devicePrefix));
      const binaryStates = states.filter(s => s.entity_id.startsWith(binaryPrefix));
      const getValue = (suffix) => { const entity = deviceStates.find(s => s.entity_id === `${devicePrefix}${suffix}`); return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null; };
      const parseNum = (val) => val !== null ? parseFloat(val) : 0;
      const onlineEntity = binaryStates.find(s => s.entity_id.includes('_online_status'));
      const isOnline = onlineEntity?.state === 'on' || (getValue('pv_power') !== null);
      const gridPower = Math.round(parseNum(getValue('grid_power')));
      const acInputVoltage = parseNum(getValue('ac_input_voltage')) || parseNum(getValue('grid_voltage'));
      const hasGridPower = gridPower > 50 || acInputVoltage > 100;
      const gridToday = Math.round(parseNum(getValue('grid_today')) * 100) / 100;
      
      devices.push({ 
        deviceId, isOnline, hasGridPower, 
        realtime: { 
          batterySoc: Math.round(parseNum(getValue('battery_soc'))), 
          pvPower: Math.round(parseNum(getValue('pv_power'))), 
          batteryPower: Math.round(parseNum(getValue('battery_power'))), 
          loadPower: Math.round(parseNum(getValue('total_load_power')) || parseNum(getValue('load_power'))), 
          gridPower, acInputVoltage, 
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

async function getWeather(location) {
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
      
      return { 
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
    }
  } catch (e) { }
  
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
        
        return {
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
      }
    }
  } catch (e) { }
  
  return null;
}

async function sendTelegram(chatId, text) {
  try { 
    const response = await fetch(TELEGRAM_API + '/sendMessage', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }) 
    }); 
    return (await response.json()).ok; 
  } catch (e) { return false; }
}

async function processNotifications(env) {
  const devicesData = await loadDevicesData(env);
  const haDevices = await fetchAllDevicesFromHA(env);
  const previousStates = await loadDeviceStates(env);
  const currentStates = {};
  const notifications = [];
  const vnHour = getVietnamHour();
  const vnDate = getVietnamDate();

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
    const currentState = { hasGridPower: haDevice.hasGridPower, batterySoc: rt.batterySoc, pvPower: rt.pvPower, isLowBattery: rt.batterySoc <= 20, hasPV: rt.pvPower > 50, lastUpdate: Date.now(), powerOutageTime: prevState.powerOutageTime || null };

    // ⚡ MẤT ĐIỆN LƯỚI
    if (prefs.powerOutage && prevState.hasGridPower === true && !currentState.hasGridPower) {
      currentState.powerOutageTime = Date.now();
      let statusMsg = '';
      const hoursLeft = Math.round((rt.batterySoc / 100) * (rt.loadPower > 200 ? 4 : 8));
      if (rt.pvPower > 100) statusMsg = '\n\n💡 _PV đang hoạt động, hỗ trợ cấp điện_';
      else if (rt.batterySoc >= 50) statusMsg = `\n\n💡 _Pin đủ sử dụng khoảng ${hoursLeft}h_`;
      else if (rt.batterySoc < 30) statusMsg = '\n\n⚠️ _Cảnh báo: Pin thấp, hạn chế sử dụng!_';
      notifications.push({ chatId, message: `⚡🔴 *MẤT ĐIỆN LƯỚI EVN*\n📱 \`${deviceId}\`\n\n❌ Điện lưới đã ngắt!\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n☀️ PV: *${rt.pvPower}W*\n🏠 Tải: *${rt.loadPower}W*${statusMsg}\n\n🕐 ${getVietnamTime()}` });
    }

    // ✅ CÓ ĐIỆN LẠI
    if (prefs.powerRestored && prevState.hasGridPower === false && currentState.hasGridPower) {
      let durationMsg = '';
      if (prevState.powerOutageTime) { 
        const mins = Math.floor((Date.now() - prevState.powerOutageTime) / 60000); 
        const outageDuration = mins >= 60 ? `${Math.floor(mins/60)} giờ ${mins%60} phút` : `${mins} phút`; 
        durationMsg = `\n⏱️ Thời gian mất điện: *${outageDuration}*`;
      }
      let batteryMsg = rt.batterySoc < 30 ? '\n\n📊 _Pin đã giảm nhiều, đang sạc lại_' : (rt.batterySoc >= 80 ? '\n\n📊 _Pin vẫn còn tốt!_' : '');
      notifications.push({ chatId, message: `✅🟢 *CÓ ĐIỆN LẠI*\n📱 \`${deviceId}\`\n\n🎉 Điện lưới đã có!\n\n⚡ Grid: *${rt.gridPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*${durationMsg}${batteryMsg}\n\n🕐 ${getVietnamTime()}` });
      currentState.powerOutageTime = null;
    }

    // 🪫 PIN YẾU (Standard)
    if (prefs.lowBattery && !prevState.isLowBattery && currentState.isLowBattery) {
      let tip = '';
      if (!haDevice.hasGridPower && rt.pvPower < 100) tip = '\n\n⚠️ _Không có điện lưới và PV, tiết kiệm điện!_';
      else if (rt.pvPower > 200) tip = '\n\n💡 _PV đang sạc pin, sẽ hồi phục sớm_';
      else if (haDevice.hasGridPower) tip = '\n\n💡 _Điện lưới đang sạc pin_';
      else tip = '\n\n⚠️ _Hạn chế sử dụng thiết bị lớn!_';
      notifications.push({ chatId, message: `🪫🔴 *CẢNH BÁO PIN YẾU*\n📱 \`${deviceId}\`\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* - CẦN SẠC!\n\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${tip}\n\n🕐 ${getVietnamTime()}` });
    }

    // 🌇 KẾT THÚC NGÀY NẮNG
    if (prefs.pvEnded && prevState.hasPV && !currentState.hasPV && vnHour >= 16 && vnHour <= 19) {
      let nightTip = '';
      if (rt.batterySoc >= 80) nightTip = '\n\n✅ _Pin đầy đủ cho đêm nay!_';
      else if (rt.batterySoc >= 50) nightTip = '\n\n💡 _Pin đủ dùng, nên tiết kiệm_';
      else if (haDevice.hasGridPower) nightTip = '\n\n⚡ _Điện lưới sẽ hỗ trợ qua đêm_';
      else nightTip = '\n\n⚠️ _Pin thấp, hạn chế sử dụng!_';
      notifications.push({ chatId, message: `🌇 *KẾT THÚC NGÀY NẮNG*\n📱 \`${deviceId}\`\n\n☀️ PV: *${rt.pvPower}W* (đã tắt)\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${nightTip}\n\n🌙 Chúc buổi tối vui vẻ!\n🕐 ${getVietnamTime()}` });
    }

    // 🌅 CHÀO BUỔI SÁNG
    if (prefs.morningGreeting && vnHour >= 6 && vnHour < 7) {
      const morningKey = `morning_${chatId}_${deviceId}`;
      if (await env.BOT_KV?.get(morningKey) !== vnDate) {
        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
        const locationName = userDevice.location || 'TP. Ho Chi Minh';
        let solarTip = '☀️ Hệ thống sẵn sàng đón nắng!';
        let weatherTip = '';
        
        if (weather) {
          if (weather.rainChance > 70) { weatherTip = '\n☔ _Khả năng mưa cao, PV có thể thấp hơn bình thường_'; solarTip = '🌧️ Ngày nhiều mây, PV có thể hạn chế'; }
          else if (weather.rainChance > 40) weatherTip = '\n🌦️ _Có thể có mưa rào, theo dõi PV_';
          else if (weather.uvIndex >= 8) { weatherTip = '\n🔥 _Chỉ số UV cao, PV sẽ hoạt động tốt!_'; solarTip = '☀️ Ngày nắng đẹp, PV hoạt động tối ưu!'; }
          else if (weather.uvIndex >= 5) solarTip = '☀️ Ngày nắng vừa, PV hoạt động tốt!';
          
          const weatherInfo = `\n\n🌤️ *Thời tiết ${locationName}:*\n${weather.icon} ${weather.description}\n🌡️ Nhiệt độ: ${weather.tempMin}°C - ${weather.tempMax}°C\n💧 Độ ẩm: ${weather.humidity}%\n💨 Gió: ${weather.windSpeed} km/h\n🌧️ Khả năng mưa: ${weather.rainChance}%\n☀️ UV: ${weather.uvIndex}\n🌅 Mặt trời mọc: ${weather.sunrise} | lặn: ${weather.sunset}${weatherTip}`;
          notifications.push({ chatId, message: `🌅 *CHÀO BUỔI SÁNG!*\n📱 \`${deviceId}\`\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n${solarTip}${weatherInfo}\n\n🕐 ${getVietnamTime()}` });
        } else {
          notifications.push({ chatId, message: `🌅 *CHÀO BUỔI SÁNG!*\n📱 \`${deviceId}\`\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n${solarTip}\n\n🕐 ${getVietnamTime()}` });
        }
        if (env.BOT_KV) await env.BOT_KV.put(morningKey, vnDate, { expirationTtl: 86400 });
      }
    }

    // ⏰ BÁO CÁO MỖI GIỜ
    if (prefs.hourlyStatus && vnHour >= 6 && vnHour <= 21) {
      const hourlyKey = `hourly_${chatId}_${deviceId}_${vnHour}`;
      if (await env.BOT_KV?.get(hourlyKey) !== vnDate) {
        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
        const locationName = userDevice.location || 'TP. Ho Chi Minh';
        let timeLabel = '', timeEmoji = '', tip = '';
        
        if (vnHour >= 6 && vnHour < 9) { timeLabel = 'SÁNG SỚM'; timeEmoji = '🌅'; tip = rt.pvPower > 100 ? '\n\n💡 _PV bắt đầu hoạt động!_' : '\n\n💡 _Chờ nắng lên để PV hoạt động_'; }
        else if (vnHour >= 9 && vnHour < 12) { timeLabel = 'BUỔI SÁNG'; timeEmoji = '☀️'; tip = rt.pvPower > 500 ? '\n\n🔥 _PV đang hoạt động mạnh!_' : ''; }
        else if (vnHour >= 12 && vnHour < 14) { timeLabel = 'GIỮA TRƯA'; timeEmoji = '🌞'; tip = rt.pvPower > 800 ? '\n\n🔥 _Đỉnh điểm nắng! PV max!_' : ''; }
        else if (vnHour >= 14 && vnHour < 17) { timeLabel = 'BUỔI CHIỀU'; timeEmoji = '🌤️'; tip = rt.pvPower < 200 && rt.pvPower > 0 ? '\n\n📉 _PV giảm dần theo chiều_' : ''; }
        else if (vnHour >= 17 && vnHour < 19) { timeLabel = 'CHIỀU TỐI'; timeEmoji = '🌇'; tip = rt.pvPower < 50 ? '\n\n🌆 _PV sắp kết thúc, chuyển sang pin/lưới_' : ''; }
        else { timeLabel = 'BUỔI TỐI'; timeEmoji = '🌙'; tip = '\n\n🌙 _Nghỉ ngơi và sạc pin cho ngày mai!_'; }
        
        let batteryStatus = rt.batterySoc >= 80 ? '💚 Tuyệt vời!' : rt.batterySoc >= 50 ? '🟢 Tốt' : rt.batterySoc >= 20 ? '🟡 Trung bình' : '🔴 Cần sạc!';
        let weatherInfo = '';
        if (weather) {
          weatherInfo = `\n\n🌤️ *Thời tiết ${locationName}:*\n${weather.icon} ${weather.currentDescription}\n🌡️ ${weather.currentTemp}°C | 💧 ${weather.humidity}% | 💨 ${weather.windSpeed} km/h`;
        }
        
        notifications.push({ chatId, message: `${timeEmoji} *${timeLabel}*\n📱 \`${deviceId}\`\n\n☀️ PV: *${rt.pvPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* ${batteryStatus}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${weatherInfo}${tip}\n\n🕐 ${getVietnamTime()}` });
        if (env.BOT_KV) await env.BOT_KV.put(hourlyKey, vnDate, { expirationTtl: 7200 });
      }
    }

    // ⚙️ CUSTOM THRESHOLD ALERTS
    
    // 🔋💚 PIN ĐẦY (Custom)
    if (thresholds.batteryFull < 100 && rt.batterySoc >= thresholds.batteryFull) {
      const alertedValue = await getThresholdAlertKey(env, 'full', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryFull)) {
        notifications.push({ chatId, message: `🔋💚 *PIN ĐẦY*\n📱 \`${deviceId}\`\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🎯 Ngưỡng: ${thresholds.batteryFull}%\n\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'full', chatId, deviceId, thresholds.batteryFull);
      }
    }
    
    // 🪫🔴 PIN THẤP (Custom)
    if (thresholds.batteryLow > 0 && rt.batterySoc <= thresholds.batteryLow) {
      const alertedValue = await getThresholdAlertKey(env, 'low', chatId, deviceId);
      if (alertedValue !== String(thresholds.batteryLow)) {
        notifications.push({ chatId, message: `🪫🔴 *PIN THẤP*\n📱 \`${deviceId}\`\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🎯 Ngưỡng: ${thresholds.batteryLow}%\n\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'low', chatId, deviceId, thresholds.batteryLow);
      }
    }
    
    // ☀️🎉 PV ĐẠT NGƯỠNG
    if (thresholds.pvDaily > 0 && de.pvDay >= thresholds.pvDaily) {
      const alertedValue = await getThresholdAlertKey(env, 'pv', chatId, deviceId);
      if (alertedValue !== String(thresholds.pvDaily)) {
        notifications.push({ chatId, message: `☀️🎉 *PV ĐẠT NGƯỠNG*\n📱 \`${deviceId}\`\n\n📊 PV hôm nay: *${de.pvDay} kWh*\n🎯 Ngưỡng: ${thresholds.pvDaily} kWh\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🏠 Tiêu thụ: *${de.loadDay} kWh*\n\n✨ _Tuyệt vời! Hệ thống hoạt động hiệu quả!_\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'pv', chatId, deviceId, thresholds.pvDaily);
      }
    }
    
    // ⚡⚠️ EVN ĐẠT NGƯỠNG
    if (thresholds.gridUsage > 0 && de.gridDay >= thresholds.gridUsage) {
      const alertedValue = await getThresholdAlertKey(env, 'grid', chatId, deviceId);
      if (alertedValue !== String(thresholds.gridUsage)) {
        notifications.push({ chatId, message: `⚡⚠️ *EVN ĐẠT NGƯỠNG*\n📱 \`${deviceId}\`\n\n📊 EVN hôm nay: *${de.gridDay} kWh*\n🎯 Ngưỡng: ${thresholds.gridUsage} kWh\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n☀️ PV hôm nay: *${de.pvDay} kWh*\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'grid', chatId, deviceId, thresholds.gridUsage);
      }
    }
    
    // 🏠📈 TIÊU THỤ ĐẠT NGƯỠNG
    if (thresholds.loadDaily > 0 && de.loadDay >= thresholds.loadDaily) {
      const alertedValue = await getThresholdAlertKey(env, 'load', chatId, deviceId);
      if (alertedValue !== String(thresholds.loadDaily)) {
        notifications.push({ chatId, message: `🏠📈 *TIÊU THỤ ĐẠT NGƯỠNG*\n📱 \`${deviceId}\`\n\n📊 Tiêu thụ hôm nay: *${de.loadDay} kWh*\n🎯 Ngưỡng: ${thresholds.loadDaily} kWh\n\n☀️ PV: *${de.pvDay} kWh*\n⚡ EVN: *${de.gridDay} kWh*\n\n💡 _Lưu ý tiết kiệm điện!_\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'load', chatId, deviceId, thresholds.loadDaily);
      }
    }
    
    // ⚡🔴 ĐIỆN ÁP CAO (QUÁ ÁP) - v2.0
    if (thresholds.voltageHigh > 0 && rt.acInputVoltage >= thresholds.voltageHigh) {
      const alertedValue = await getThresholdAlertKey(env, 'vhigh', chatId, deviceId);
      if (alertedValue !== String(thresholds.voltageHigh)) {
        const riskLevel = rt.acInputVoltage >= 270 ? '🔴 NGUY HIỂM!' : (rt.acInputVoltage >= 260 ? '🟠 Cao' : '🟡 Hơi cao');
        const tip = rt.acInputVoltage >= 270 ? '\n\n⚠️ _Cảnh báo: Điện áp quá cao có thể gây hỏng thiết bị!_' : '\n\n💡 _Theo dõi và hạn chế sử dụng thiết bị nhạy cảm._';
        notifications.push({ chatId, message: `⚡🔴 *ĐIỆN ÁP CAO*\n📱 \`${deviceId}\`\n\n🔌 Điện áp: *${rt.acInputVoltage}V* ${riskLevel}\n🎯 Ngưỡng: ${thresholds.voltageHigh}V\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${tip}\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'vhigh', chatId, deviceId, thresholds.voltageHigh);
      }
    }
    
    // ⚡🟡 ĐIỆN ÁP THẤP (THẤP ÁP) - v2.0
    if (thresholds.voltageLow > 0 && rt.acInputVoltage > 0 && rt.acInputVoltage <= thresholds.voltageLow) {
      const alertedValue = await getThresholdAlertKey(env, 'vlow', chatId, deviceId);
      if (alertedValue !== String(thresholds.voltageLow)) {
        const riskLevel = rt.acInputVoltage <= 170 ? '🔴 NGUY HIỂM!' : (rt.acInputVoltage <= 180 ? '🟠 Thấp' : '🟡 Hơi thấp');
        const tip = rt.acInputVoltage <= 170 ? '\n\n⚠️ _Cảnh báo: Điện áp quá thấp có thể gây hỏng máy nén, động cơ!_' : '\n\n💡 _Hạn chế sử dụng điều hòa, tủ lạnh khi điện yếu._';
        notifications.push({ chatId, message: `⚡🟡 *ĐIỆN ÁP THẤP*\n📱 \`${deviceId}\`\n\n🔌 Điện áp: *${rt.acInputVoltage}V* ${riskLevel}\n🎯 Ngưỡng: ${thresholds.voltageLow}V\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(haDevice.hasGridPower)}${tip}\n\n🕐 ${getVietnamTime()}` });
        await setThresholdAlertKey(env, 'vlow', chatId, deviceId, thresholds.voltageLow);
      }
    }

    currentStates[stateKey] = currentState;
  }

  await saveDeviceStates(env, { ...previousStates, ...currentStates });
  for (const notif of notifications) { await sendTelegram(notif.chatId, notif.message); await new Promise(r => setTimeout(r, 100)); }
  return { sent: notifications.length, checked: devicesData.length, haDevices: haDevices.length };
}

// ============================================
// 📋 COMMAND HANDLERS
// ============================================

async function handleHelp(chatId, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  let thresholdsInfo = '';
  
  if (userDevices.length > 0) {
    const th = userDevices[0].thresholds || DEFAULT_THRESHOLDS;
    thresholdsInfo = `\n\n⚙️ *Ngưỡng cảnh báo:*\n🔋 Pin đầy: ${th.batteryFull}%${th.batteryFull >= 100 ? ' ❌' : ' ✅'}\n🪫 Pin thấp: ${th.batteryLow}%\n☀️ PV/ngày: ${th.pvDaily} kWh${th.pvDaily <= 0 ? ' ❌' : ' ✅'}\n⚡ EVN/ngày: ${th.gridUsage} kWh${th.gridUsage <= 0 ? ' ❌' : ' ✅'}\n🏠 Tiêu thụ/ngày: ${th.loadDaily} kWh${th.loadDaily <= 0 ? ' ❌' : ' ✅'}\n🔌 Điện áp cao: ${th.voltageHigh || 0}V${(th.voltageHigh || 0) <= 0 ? ' ❌' : ' ✅'}\n🔌 Điện áp thấp: ${th.voltageLow || 0}V${(th.voltageLow || 0) <= 0 ? ' ❌' : ' ✅'}`;
  }
  
  await sendTelegram(chatId, `🤖 *LightEarth Bot v2.0*\n━━━━━━━━━━━━━━━━━\n\n📱 *Quản lý thiết bị:*\n/add <ID> - ➕ Thêm thiết bị\n/remove <ID> - ➖ Xóa thiết bị\n/list - 📋 Danh sách thiết bị\n\n📊 *Trạng thái:*\n/status - 📈 Trạng thái tất cả\n/check <ID> - 🔍 Kiểm tra 1 thiết bị\n\n⚙️ *Cài đặt:*\n/settings - 🔔 Loại thông báo\n/thresholds - 🎯 Ngưỡng cảnh báo\n/location - 📍 Vùng thời tiết\n\n🔔 *Thông báo tự động:*\n🌅 Chào buổi sáng + Thời tiết\n⚡ Mất điện lưới EVN\n✅ Có điện lại\n🪫 Pin yếu (<20%)\n🌇 Kết thúc ngày nắng\n⏰ Báo cáo mỗi giờ (6h-21h)${thresholdsInfo}`);
}

async function handleThresholds(chatId, args, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `⚙️ *Cài đặt ngưỡng*\n\n_(Chưa có thiết bị)_\n\n➕ Thêm: /add`); return; }
  
  if (args.length === 0 && userDevices.length > 1) { 
    let list = `🎯 *Cài đặt ngưỡng cảnh báo*\n\nChọn thiết bị:\n\n`; 
    userDevices.forEach((d, i) => { const th = d.thresholds || DEFAULT_THRESHOLDS; list += `${i + 1}. 📱 \`${d.deviceId}\`\n   🔋 ${th.batteryFull}% | 🪫 ${th.batteryLow}% | ☀️ ${th.pvDaily}kWh\n\n`; }); 
    list += `📝 Nhập số để chọn thiết bị:`; 
    userStates.set(chatId, { waiting: 'thresholds_device', devices: userDevices.map(d => d.deviceId) }); 
    await sendTelegram(chatId, list); 
    return; 
  }
  
  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy thiết bị`); return; }
  
  const th = device.thresholds || DEFAULT_THRESHOLDS;
  userStates.set(chatId, { waiting: 'thresholds_select', deviceId: device.deviceId });
  await sendTelegram(chatId, `🎯 *Ngưỡng cảnh báo*\n📱 \`${device.deviceId}\`\n\n1️⃣ 🔋 Pin đầy: *${th.batteryFull}%* ${th.batteryFull >= 100 ? '❌ TẮT' : '✅'}\n2️⃣ 🪫 Pin thấp: *${th.batteryLow}%*\n3️⃣ ☀️ PV/ngày: *${th.pvDaily} kWh* ${th.pvDaily <= 0 ? '❌ TẮT' : '✅'}\n4️⃣ ⚡ EVN/ngày: *${th.gridUsage} kWh* ${th.gridUsage <= 0 ? '❌ TẮT' : '✅'}\n5️⃣ 🏠 Tiêu thụ/ngày: *${th.loadDaily} kWh* ${th.loadDaily <= 0 ? '❌ TẮT' : '✅'}\n6️⃣ 🔌 Điện áp cao: *${th.voltageHigh || 0}V* ${(th.voltageHigh || 0) <= 0 ? '❌ TẮT' : '✅'}\n7️⃣ 🔌 Điện áp thấp: *${th.voltageLow || 0}V* ${(th.voltageLow || 0) <= 0 ? '❌ TẮT' : '✅'}\n\n📝 Nhập số (1-7) để thay đổi:\n🚪 Nhập \`0\` để thoát`);
}

async function handleAdd(chatId, args, env, devicesData) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'add_device' }); await sendTelegram(chatId, `➕ *Thêm thiết bị*\n\n📝 Nhập Device ID:`); return devicesData; }
  const deviceId = args[0].toUpperCase();
  if (!/^[HP]\d{6,}$/.test(deviceId)) { await sendTelegram(chatId, `❌ Device ID không hợp lệ!\n\nPhải bắt đầu bằng H hoặc P + số`); return devicesData; }
  const haDevices = await fetchAllDevicesFromHA(env);
  if (!haDevices.some(d => d.deviceId?.toUpperCase() === deviceId)) { await sendTelegram(chatId, `❌ Thiết bị \`${deviceId}\` chưa có trong hệ thống!\n\n📱 Tham gia Zalo:\n👉 https://zalo.me/g/kmzrgh433`); return devicesData; }
  const result = await addDevice(env, devicesData, chatId, deviceId);
  await sendTelegram(chatId, result.success ? `✅ Đã thêm \`${deviceId}\`!\n\n🔔 Bạn sẽ nhận thông báo khi:\n• ⚡ Mất điện\n• ✅ Có điện lại\n• 🪫 Pin yếu\n• 🌇 Hết PV\n\n⚙️ Dùng /settings để tùy chỉnh\n🎯 Dùng /thresholds để đặt ngưỡng\n📍 Dùng /location để chọn vùng` : `ℹ️ Thiết bị đã có trong danh sách.`);
  return result.devicesData;
}

async function handleRemove(chatId, args, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📋 Bạn chưa có thiết bị nào.`); return devicesData; }
  if (args.length === 0) { let list = `➖ *Xóa thiết bị*\n\n`; userDevices.forEach((d, i) => { list += `${i + 1}. 📱 \`${d.deviceId}\`\n`; }); list += `\n📝 Nhập số hoặc Device ID:`; userStates.set(chatId, { waiting: 'remove_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list); return devicesData; }
  let deviceId = args[0];
  if (/^\d+$/.test(deviceId)) { const idx = parseInt(deviceId) - 1; if (idx >= 0 && idx < userDevices.length) deviceId = userDevices[idx].deviceId; }
  const result = await removeDevice(env, devicesData, chatId, deviceId);
  await sendTelegram(chatId, result.success ? `✅ Đã xóa \`${deviceId.toUpperCase()}\`` : `❌ Không tìm thấy`);
  return result.devicesData;
}

async function handleList(chatId, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📋 *Danh sách*\n\n_(Chưa có thiết bị)_\n\n➕ Thêm: /add <ID>`); return; }
  let msg = `📋 *Danh sách thiết bị*\n\n`;
  userDevices.forEach((d, i) => { msg += `${i + 1}. 📱 \`${d.deviceId}\`\n   📍 ${d.location || "Chưa đặt"}\n\n`; });
  await sendTelegram(chatId, msg);
}

async function handleStatus(chatId, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📊 *Trạng thái*\n\n_(Chưa có thiết bị)_\n\n➕ Thêm: /add`); return; }
  const haDevices = await fetchAllDevicesFromHA(env);
  let msg = `📊 *Trạng thái thiết bị*\n━━━━━━━━━━━━━━━━━\n\n`;
  for (const userDevice of userDevices) {
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === userDevice.deviceId.toUpperCase());
    if (haDevice?.realtime) { const rt = haDevice.realtime; msg += `📱 *${userDevice.deviceId}* ${haDevice.isOnline ? '🟢' : '🔴'}\n   ☀️ PV: ${rt.pvPower}W\n   ${getBatteryIcon(rt.batterySoc)} Pin: ${rt.batterySoc}%\n   🏠 Load: ${rt.loadPower}W\n   ⚡ Grid: ${rt.gridPower}W ${getGridIcon(haDevice.hasGridPower)}\n\n`; }
    else { msg += `📱 *${userDevice.deviceId}*\n   ⚠️ _Không có dữ liệu_\n\n`; }
  }
  msg += `🕐 ${getVietnamTime()}`;
  await sendTelegram(chatId, msg);
}

async function handleCheck(chatId, args, env) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'check_device' }); await sendTelegram(chatId, `🔍 *Kiểm tra*\n\n📝 Nhập Device ID:`); return; }
  const deviceId = args[0].toUpperCase();
  const haDevices = await fetchAllDevicesFromHA(env);
  const device = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId);
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy \`${deviceId}\``); return; }
  const rt = device.realtime, de = device.dailyEnergy;
  await sendTelegram(chatId, `📊 *${deviceId}* ${device.isOnline ? '🟢 Online' : '🔴 Offline'}\n━━━━━━━━━━━━━━━━━\n\n☀️ PV: *${rt.pvPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* (${rt.batteryPower}W)\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${device.hasGridPower ? '🟢 Có điện' : '🔴 Mất điện'}\n🌡️ Nhiệt độ: *${rt.temperature}°C*\n\n📈 *Hôm nay:*\n   ☀️ PV: ${de.pvDay} kWh\n   🏠 Load: ${de.loadDay} kWh\n   ⚡ Grid: ${de.gridDay || 0} kWh\n\n🕐 ${getVietnamTime()}`);
}

async function handleSettings(chatId, args, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `⚙️ *Cài đặt*\n\n_(Chưa có thiết bị)_\n\n➕ Thêm: /add`); return; }
  if (args.length === 0 && userDevices.length > 1) { let list = `🔔 *Cài đặt thông báo*\n\nChọn thiết bị:\n\n`; userDevices.forEach((d, i) => { list += `${i + 1}. 📱 \`${d.deviceId}\`\n`; }); list += `\n📝 Nhập số hoặc Device ID:`; userStates.set(chatId, { waiting: 'settings_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list); return; }
  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { await sendTelegram(chatId, `❌ Không tìm thấy thiết bị`); return; }
  const prefs = device.notifications || {};
  const getIcon = (val) => val ? '✅' : '❌';
  userStates.set(chatId, { waiting: 'settings_toggle', deviceId: device.deviceId });
  await sendTelegram(chatId, `🔔 *Cài đặt thông báo*\n📱 \`${device.deviceId}\`\n\n1️⃣ ${getIcon(prefs.morningGreeting)} 🌅 Chào buổi sáng + Thời tiết\n2️⃣ ${getIcon(prefs.powerOutage)} ⚡ Mất điện lưới EVN\n3️⃣ ${getIcon(prefs.powerRestored)} ✅ Có điện lại\n4️⃣ ${getIcon(prefs.lowBattery)} 🪫 Pin yếu (<20%)\n5️⃣ ${getIcon(prefs.pvEnded)} 🌇 Hết PV (chuyển xài pin)\n6️⃣ ${getIcon(prefs.hourlyStatus)} ⏰ Báo cáo mỗi giờ (6h-21h)\n\n📝 *Cách đổi:* Gõ số (1-6) để bật/tắt\n🚪 Gõ \`0\` để thoát`);
}

async function handleLocation(chatId, args, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, `📍 *Cài đặt vùng*\n\n_(Chưa có thiết bị)_\n\n➕ Thêm: /add`); return; }
  let list = `📍 *Cài đặt vùng thời tiết*\n\nChọn thiết bị:\n\n`;
  userDevices.forEach((d, i) => { list += `${i + 1}. 📱 \`${d.deviceId}\`\n   📍 ${d.location || "Chưa đặt"}\n\n`; });
  list += `📝 Nhập số để chọn thiết bị:`;
  userStates.set(chatId, { waiting: 'location_select_device', devices: userDevices.map(d => ({ id: d.deviceId, location: d.location })) });
  await sendTelegram(chatId, list);
}

// ============================================
// 🔗 DEEP LINK HANDLER v2.0 - ULTRA SHORT FORMAT + VOLTAGE
// ============================================
// OLD v1.9.0: add_P250802210_111110_95_20_10_5_15_hcm (44 chars)
// NEW v2.0: add_P250802210_111110_95_20_10_5_15_260_180_hcm (52 chars) ✅
//
// Format: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_vh_vl_loc
// - NNNNNN: 6 bits for notifications
// - bf_bl_pv_gr_ld_vh_vl: compact threshold numbers (with voltage)
// - loc: 2-4 char location code

async function handleStart(chatId, text, env, devicesData) {
  const payloadMatch = text.match(/\/start\s+(.+)/i);
  if (!payloadMatch) {
    await handleHelp(chatId, devicesData);
    return devicesData;
  }
  
  const payload = payloadMatch[1].trim();
  
  // ============================================
  // NEW v2.0 FORMAT: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_vh_vl_loc
  // Example: add_P250802210_111110_95_20_10_5_15_260_180_hcm
  // ============================================
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
      voltageHigh: parseInt(vh),
      voltageLow: parseInt(vl)
    };
    
    // Check if device exists in HA
    const haDevices = await fetchAllDevicesFromHA(env);
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId.toUpperCase());
    
    if (!haDevice) {
      await sendTelegram(chatId, `❌ Thiết bị \`${deviceId.toUpperCase()}\` chưa có trong hệ thống!\n\n📱 Tham gia Zalo để được hỗ trợ:\n👉 https://zalo.me/g/kmzrgh433`);
      return devicesData;
    }
    
    // Add or update device
    const result = await addDeviceWithSettings(env, devicesData, chatId, deviceId.toUpperCase(), notifications, location, thresholds);
    
    // Build response message
    const getIcon = (val) => val ? '✅' : '❌';
    const notifList = [
      `${getIcon(notifications.morningGreeting)} 🌅 Chào buổi sáng`,
      `${getIcon(notifications.powerOutage)} ⚡ Mất điện`,
      `${getIcon(notifications.powerRestored)} ✅ Có điện lại`,
      `${getIcon(notifications.lowBattery)} 🪫 Pin yếu`,
      `${getIcon(notifications.pvEnded)} 🌇 Hết PV`,
      `${getIcon(notifications.hourlyStatus)} ⏰ Báo cáo mỗi giờ`
    ].join('\n');
    
    const thresholdList = [
      `🔋 Pin đầy: ${thresholds.batteryFull}% ${thresholds.batteryFull >= 100 ? '❌' : '✅'}`,
      `🪫 Pin thấp: ${thresholds.batteryLow}%`,
      `☀️ PV/ngày: ${thresholds.pvDaily} kWh ${thresholds.pvDaily <= 0 ? '❌' : '✅'}`,
      `⚡ EVN/ngày: ${thresholds.gridUsage} kWh ${thresholds.gridUsage <= 0 ? '❌' : '✅'}`,
      `🏠 Tiêu thụ/ngày: ${thresholds.loadDaily} kWh ${thresholds.loadDaily <= 0 ? '❌' : '✅'}`,
      `🔌 Điện áp cao: ${thresholds.voltageHigh}V ${thresholds.voltageHigh <= 0 ? '❌' : '✅'}`,
      `🔌 Điện áp thấp: ${thresholds.voltageLow}V ${thresholds.voltageLow <= 0 ? '❌' : '✅'}`
    ].join('\n');
    
    const action = result.isNew ? '✅ *ĐÃ THÊM THIẾT BỊ*' : '✅ *ĐÃ CẬP NHẬT THIẾT BỊ*';
    
    await sendTelegram(chatId, `${action}\n\n📱 Device: \`${deviceId.toUpperCase()}\`\n📍 Vùng: *${location}*\n\n🔔 *Thông báo:*\n${notifList}\n\n🎯 *Ngưỡng cảnh báo:*\n${thresholdList}\n\n✨ _Deep Link v2.0 đã được đồng bộ!_\n\n⚙️ /settings - thay đổi thông báo\n🎯 /thresholds - thay đổi ngưỡng\n📍 /location - thay đổi vùng\n\n🕐 ${getVietnamTime()}`);
    
    return result.devicesData;
  }
  
  // ============================================
  // LEGACY v1.9.0 FORMAT: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_loc (backward compatible)
  // Example: add_P250802210_111110_95_20_10_5_15_hcm
  // ============================================
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
      voltageHigh: 0,
      voltageLow: 0
    };
    
    // Check if device exists in HA
    const haDevices = await fetchAllDevicesFromHA(env);
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId.toUpperCase());
    
    if (!haDevice) {
      await sendTelegram(chatId, `❌ Thiết bị \`${deviceId.toUpperCase()}\` chưa có trong hệ thống!\n\n📱 Tham gia Zalo để được hỗ trợ:\n👉 https://zalo.me/g/kmzrgh433`);
      return devicesData;
    }
    
    // Add or update device
    const result = await addDeviceWithSettings(env, devicesData, chatId, deviceId.toUpperCase(), notifications, location, thresholds);
    
    // Build response message
    const getIcon = (val) => val ? '✅' : '❌';
    const notifList = [
      `${getIcon(notifications.morningGreeting)} 🌅 Chào buổi sáng`,
      `${getIcon(notifications.powerOutage)} ⚡ Mất điện`,
      `${getIcon(notifications.powerRestored)} ✅ Có điện lại`,
      `${getIcon(notifications.lowBattery)} 🪫 Pin yếu`,
      `${getIcon(notifications.pvEnded)} 🌇 Hết PV`,
      `${getIcon(notifications.hourlyStatus)} ⏰ Báo cáo mỗi giờ`
    ].join('\n');
    
    const thresholdList = [
      `🔋 Pin đầy: ${thresholds.batteryFull}% ${thresholds.batteryFull >= 100 ? '❌' : '✅'}`,
      `🪫 Pin thấp: ${thresholds.batteryLow}%`,
      `☀️ PV/ngày: ${thresholds.pvDaily} kWh ${thresholds.pvDaily <= 0 ? '❌' : '✅'}`,
      `⚡ EVN/ngày: ${thresholds.gridUsage} kWh ${thresholds.gridUsage <= 0 ? '❌' : '✅'}`,
      `🏠 Tiêu thụ/ngày: ${thresholds.loadDaily} kWh ${thresholds.loadDaily <= 0 ? '❌' : '✅'}`
    ].join('\n');
    
    const action = result.isNew ? '✅ *ĐÃ THÊM THIẾT BỊ*' : '✅ *ĐÃ CẬP NHẬT THIẾT BỊ*';
    
    await sendTelegram(chatId, `${action}\n\n📱 Device: \`${deviceId.toUpperCase()}\`\n📍 Vùng: *${location}*\n\n🔔 *Thông báo:*\n${notifList}\n\n🎯 *Ngưỡng cảnh báo:*\n${thresholdList}\n\n✨ _Short Deep Link v1.9.0 đã được đồng bộ!_\n\n⚙️ /settings - thay đổi thông báo\n🎯 /thresholds - thay đổi ngưỡng\n📍 /location - thay đổi vùng\n\n🕐 ${getVietnamTime()}`);
    
    return result.devicesData;
  }
  
  // ============================================
  // LEGACY FORMAT v1.8.0: add_DEVICEID_mg_po_pr_lb_pe_hs_loc_LOCATION_bf100_bl20_pv0_gr0_ld0
  // ============================================
  const addMatch = payload.match(/^add_([HP]\d+)/i);
  
  if (addMatch) {
    const deviceId = addMatch[1].toUpperCase();
    
    // Parse notification settings (mg, po, pr, lb, pe, hs)
    const notifications = {
      morningGreeting: payload.includes('_mg'),
      powerOutage: payload.includes('_po'),
      powerRestored: payload.includes('_pr'),
      lowBattery: payload.includes('_lb'),
      pvEnded: payload.includes('_pe'),
      hourlyStatus: payload.includes('_hs')
    };
    
    // If no settings specified, use defaults
    const hasAnyNotif = Object.values(notifications).some(v => v);
    if (!hasAnyNotif) {
      notifications.morningGreeting = true;
      notifications.powerOutage = true;
      notifications.powerRestored = true;
      notifications.lowBattery = true;
      notifications.pvEnded = true;
      notifications.hourlyStatus = false;
    }
    
    // Parse location (try short code first, then legacy format)
    let location = "TP. Ho Chi Minh";
    const shortLocMatch = payload.match(/_([a-z]{2,4})$/i);
    if (shortLocMatch) {
      location = decodeLocationCode(shortLocMatch[1]);
    } else {
      const locMatch = payload.match(/loc_([^_]+(?:_[^_bf][^_]*)*)/i);
      if (locMatch) {
        location = decodeLocationCode(locMatch[1]);
      }
    }
    
    // Parse thresholds
    const thresholds = { ...DEFAULT_THRESHOLDS };
    const bfMatch = payload.match(/bf(\d+)/i);
    const blMatch = payload.match(/bl(\d+)/i);
    const pvMatch = payload.match(/pv(\d+)/i);
    const grMatch = payload.match(/gr(\d+)/i);
    const ldMatch = payload.match(/ld(\d+)/i);
    
    if (bfMatch) thresholds.batteryFull = parseInt(bfMatch[1]);
    if (blMatch) thresholds.batteryLow = parseInt(blMatch[1]);
    if (pvMatch) thresholds.pvDaily = parseInt(pvMatch[1]);
    if (grMatch) thresholds.gridUsage = parseInt(grMatch[1]);
    if (ldMatch) thresholds.loadDaily = parseInt(ldMatch[1]);
    
    // Check if device exists in HA
    const haDevices = await fetchAllDevicesFromHA(env);
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId);
    
    if (!haDevice) {
      await sendTelegram(chatId, `❌ Thiết bị \`${deviceId}\` chưa có trong hệ thống!\n\n📱 Tham gia Zalo để được hỗ trợ:\n👉 https://zalo.me/g/kmzrgh433`);
      return devicesData;
    }
    
    // Add or update device
    const result = await addDeviceWithSettings(env, devicesData, chatId, deviceId, notifications, location, thresholds);
    
    // Build response message
    const getIcon = (val) => val ? '✅' : '❌';
    const notifList = [
      `${getIcon(notifications.morningGreeting)} 🌅 Chào buổi sáng`,
      `${getIcon(notifications.powerOutage)} ⚡ Mất điện`,
      `${getIcon(notifications.powerRestored)} ✅ Có điện lại`,
      `${getIcon(notifications.lowBattery)} 🪫 Pin yếu`,
      `${getIcon(notifications.pvEnded)} 🌇 Hết PV`,
      `${getIcon(notifications.hourlyStatus)} ⏰ Báo cáo mỗi giờ`
    ].join('\n');
    
    const thresholdList = [
      `🔋 Pin đầy: ${thresholds.batteryFull}% ${thresholds.batteryFull >= 100 ? '❌' : '✅'}`,
      `🪫 Pin thấp: ${thresholds.batteryLow}%`,
      `☀️ PV/ngày: ${thresholds.pvDaily} kWh ${thresholds.pvDaily <= 0 ? '❌' : '✅'}`,
      `⚡ EVN/ngày: ${thresholds.gridUsage} kWh ${thresholds.gridUsage <= 0 ? '❌' : '✅'}`,
      `🏠 Tiêu thụ/ngày: ${thresholds.loadDaily} kWh ${thresholds.loadDaily <= 0 ? '❌' : '✅'}`
    ].join('\n');
    
    const action = result.isNew ? '✅ *ĐÃ THÊM THIẾT BỊ*' : '✅ *ĐÃ CẬP NHẬT THIẾT BỊ*';
    
    await sendTelegram(chatId, `${action}\n\n📱 Device: \`${deviceId}\`\n📍 Vùng: *${location}*\n\n🔔 *Thông báo:*\n${notifList}\n\n🎯 *Ngưỡng cảnh báo:*\n${thresholdList}\n\n✨ _Cài đặt từ Web UI đã được đồng bộ!_\n\n⚙️ /settings - thay đổi thông báo\n🎯 /thresholds - thay đổi ngưỡng\n📍 /location - thay đổi vùng\n\n🕐 ${getVietnamTime()}`);
    
    return result.devicesData;
  }
  
  // Legacy format: device_DEVICEID_thresholds_bf_bl_pv_gr_ld
  const legacyMatch = payload.match(/^device_(\w+)_thresholds_bf(\d+)_bl(\d+)_pv(\d+)_gr(\d+)_ld(\d+)/i);
  if (legacyMatch) {
    const [, deviceId, bf, bl, pv, gr, ld] = legacyMatch;
    const newThresholds = {
      batteryFull: parseInt(bf),
      batteryLow: parseInt(bl),
      pvDaily: parseInt(pv),
      gridUsage: parseInt(gr),
      loadDaily: parseInt(ld)
    };
    
    const device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase() && d.chatId === chatId);
    
    if (device) {
      await updateDeviceThresholds(env, devicesData, chatId, deviceId.toUpperCase(), newThresholds);
      await sendTelegram(chatId, `✅ *Cập nhật ngưỡng thành công!*\n\n📱 Thiết bị: \`${deviceId.toUpperCase()}\`\n\n🔋 Pin đầy: *${newThresholds.batteryFull}%* ${newThresholds.batteryFull >= 100 ? '❌ TẮT' : '✅'}\n🪫 Pin thấp: *${newThresholds.batteryLow}%*\n☀️ PV/ngày: *${newThresholds.pvDaily} kWh* ${newThresholds.pvDaily <= 0 ? '❌ TẮT' : '✅'}\n⚡ EVN/ngày: *${newThresholds.gridUsage} kWh* ${newThresholds.gridUsage <= 0 ? '❌ TẮT' : '✅'}\n🏠 Tiêu thụ/ngày: *${newThresholds.loadDaily} kWh* ${newThresholds.loadDaily <= 0 ? '❌ TẮT' : '✅'}\n\n🔄 _Các ngưỡng đã được reset!_`);
    } else {
      await sendTelegram(chatId, `❌ Không tìm thấy thiết bị \`${deviceId}\`\n\n➕ Dùng /add ${deviceId} để thêm trước.`);
    }
    return devicesData;
  }
  
  // Unknown format, show help
  await handleHelp(chatId, devicesData);
  return devicesData;
}

async function handleConversation(chatId, text, env, devicesData) {
  const state = userStates.get(chatId);
  if (!state) return { handled: false, devicesData };
  userStates.delete(chatId);

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
      await handleSettings(chatId, [selectedDevice], devicesData); 
      return { handled: true, devicesData };
    case 'settings_toggle':
      if (text === '0') { await sendTelegram(chatId, `🚪 Đã thoát cài đặt thông báo.`); return { handled: true, devicesData }; }
      const settingNum = parseInt(text);
      if (settingNum >= 1 && settingNum <= 6) { 
        const result = await updateDeviceSettings(env, devicesData, chatId, state.deviceId, settingNum); 
        if (result) { 
          const settingNames = { morningGreeting: "🌅 Chào buổi sáng", powerOutage: "⚡ Mất điện", powerRestored: "✅ Có điện lại", lowBattery: "🪫 Pin yếu", pvEnded: "🌇 Hết PV", hourlyStatus: "⏰ Báo cáo mỗi giờ" }; 
          await sendTelegram(chatId, `✅ *Đã cập nhật!*\n\n${settingNames[result.setting]}: ${result.newValue ? "✅ BẬT" : "❌ TẮT"}\n\n📝 Gõ số khác để tiếp tục hoặc \`0\` để thoát.`); 
          userStates.set(chatId, { waiting: 'settings_toggle', deviceId: state.deviceId }); 
        } 
      } else { 
        await sendTelegram(chatId, `❌ Vui lòng nhập số từ 1-6, hoặc \`0\` để thoát.`); 
        userStates.set(chatId, state); 
      }
      return { handled: true, devicesData };
    
    case 'thresholds_device':
      const thDevIdx = parseInt(text) - 1;
      if (thDevIdx >= 0 && thDevIdx < state.devices.length) {
        await handleThresholds(chatId, [state.devices[thDevIdx]], devicesData);
      } else {
        await sendTelegram(chatId, `❌ Lựa chọn không hợp lệ. Gõ /thresholds để thử lại.`);
      }
      return { handled: true, devicesData };
    
    case 'thresholds_select':
      if (text === '0') { await sendTelegram(chatId, `🚪 Đã thoát cài đặt ngưỡng.`); return { handled: true, devicesData }; }
      const thNum = parseInt(text);
      if (thNum >= 1 && thNum <= 7) {
        const thNames = { 1: 'batteryFull', 2: 'batteryLow', 3: 'pvDaily', 4: 'gridUsage', 5: 'loadDaily', 6: 'voltageHigh', 7: 'voltageLow' };
        const thLabels = { 1: '🔋 Pin đầy (%)', 2: '🪫 Pin thấp (%)', 3: '☀️ PV/ngày (kWh)', 4: '⚡ EVN/ngày (kWh)', 5: '🏠 Tiêu thụ/ngày (kWh)', 6: '🔌 Điện áp cao (V)', 7: '🔌 Điện áp thấp (V)' };
        const thHints = { 1: '💡 Nhập 100 để TẮT. VD: 95', 2: '💡 VD: 20 hoặc 30', 3: '💡 Nhập 0 để TẮT. VD: 10', 4: '💡 Nhập 0 để TẮT. VD: 5', 5: '💡 Nhập 0 để TẮT. VD: 15', 6: '💡 Nhập 0 để TẮT. VD: 250 hoặc 260', 7: '💡 Nhập 0 để TẮT. VD: 180 hoặc 190' };
        userStates.set(chatId, { waiting: 'thresholds_input', deviceId: state.deviceId, thresholdKey: thNames[thNum] });
        await sendTelegram(chatId, `*${thLabels[thNum]}*\n\n${thHints[thNum]}\n\n📝 Nhập giá trị mới:`);
      } else {
        await sendTelegram(chatId, `❌ Vui lòng nhập số từ 1-7, hoặc \`0\` để thoát.`);
        userStates.set(chatId, state);
      }
      return { handled: true, devicesData };
    
    case 'thresholds_input':
      const value = parseInt(text);
      if (isNaN(value) || value < 0) {
        await sendTelegram(chatId, `❌ Giá trị không hợp lệ. Vui lòng nhập số >= 0.`);
        userStates.set(chatId, state);
        return { handled: true, devicesData };
      }
      const newTh = { [state.thresholdKey]: value };
      await updateDeviceThresholds(env, devicesData, chatId, state.deviceId, newTh);
      const thLabelMap = { batteryFull: '🔋 Pin đầy', batteryLow: '🪫 Pin thấp', pvDaily: '☀️ PV/ngày', gridUsage: '⚡ EVN/ngày', loadDaily: '🏠 Tiêu thụ/ngày', voltageHigh: '🔌 Điện áp cao', voltageLow: '🔌 Điện áp thấp' };
      const unitMap = { batteryFull: '%', batteryLow: '%', pvDaily: ' kWh', gridUsage: ' kWh', loadDaily: ' kWh', voltageHigh: 'V', voltageLow: 'V' };
      await sendTelegram(chatId, `✅ *Đã cập nhật!*\n\n${thLabelMap[state.thresholdKey]}: *${value}${unitMap[state.thresholdKey]}*\n\n🔄 _Ngưỡng đã reset - sẽ báo khi đạt ngưỡng mới!_\n\n⚙️ Gõ /thresholds để tiếp tục chỉnh ngưỡng khác.`);
      return { handled: true, devicesData };
    
    case 'location_select_device':
      const devIdx = parseInt(text) - 1;
      if (devIdx >= 0 && devIdx < state.devices.length) {
        const selectedDev = state.devices[devIdx];
        userStates.set(chatId, { waiting: 'location_select_region', deviceId: selectedDev.id, currentLocation: selectedDev.location });
        await sendTelegram(chatId, `📱 *Thiết bị: ${selectedDev.id}*\n📍 Vùng hiện tại: *${selectedDev.location || "Chưa đặt"}*\n\nChọn miền:\n1️⃣ 🌴 Miền Nam\n2️⃣ 🏖️ Miền Trung\n3️⃣ 🏔️ Tây Nguyên\n4️⃣ ❄️ Miền Bắc\n\n📝 Nhập số (1-4):`);
      } else {
        await sendTelegram(chatId, `❌ Lựa chọn không hợp lệ. Gõ /location để thử lại.`);
      }
      return { handled: true, devicesData };
    
    case 'location_select_region':
      const regionNum = parseInt(text);
      if (regionNum >= 1 && regionNum <= 4) { 
        const regionMap = { 1: "Mien Nam", 2: "Mien Trung", 3: "Tay Nguyen", 4: "Mien Bac" }; 
        const regionNames = { 1: "Miền Nam", 2: "Miền Trung", 3: "Tây Nguyên", 4: "Miền Bắc" };
        const region = regionMap[regionNum]; 
        const cities = Object.entries(VIETNAM_CITIES).filter(([_, d]) => d.region === region).map(([name]) => name).sort(); 
        let message = `🌴 *${regionNames[regionNum]}*\n📱 Thiết bị: \`${state.deviceId}\`\n\nChọn tỉnh/thành phố:\n\n`; 
        cities.forEach((city, i) => { message += `${i + 1}. ${city}\n`; }); 
        message += `\n📝 Nhập số (1-${cities.length}) hoặc tên tỉnh:`; 
        userStates.set(chatId, { waiting: 'location_select_city', deviceId: state.deviceId, cities }); 
        await sendTelegram(chatId, message); 
      } else { 
        await sendTelegram(chatId, `❌ Vui lòng nhập số từ 1-4.`); 
        userStates.set(chatId, state); 
      }
      return { handled: true, devicesData };
    
    case 'location_select_city':
      let selectedCity = null;
      if (/^\d+$/.test(text) && state.cities) { const idx = parseInt(text) - 1; if (idx >= 0 && idx < state.cities.length) selectedCity = state.cities[idx]; }
      else { selectedCity = Object.keys(VIETNAM_CITIES).find(c => c.toLowerCase().includes(text.toLowerCase())); }
      if (selectedCity && VIETNAM_CITIES[selectedCity]) { 
        await updateSingleDeviceLocation(env, devicesData, chatId, state.deviceId, selectedCity); 
        await sendTelegram(chatId, `✅ *Đã cập nhật!*\n\n📱 Thiết bị: \`${state.deviceId}\`\n📍 Vùng: *${selectedCity}*\n\n🌤️ Thông báo chào buổi sáng sẽ kèm dự báo thời tiết cho khu vực này.\n\n📍 Gõ /location để tiếp tục chỉnh thiết bị khác.`); 
      } else { 
        await sendTelegram(chatId, `❌ Không tìm thấy tỉnh/thành phố. Gõ /location để thử lại.`); 
      }
      return { handled: true, devicesData };
  }
  return { handled: false, devicesData };
}

async function handleUpdate(update, env) {
  if (!update.message?.text) return;
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  let devicesData = await loadDevicesData(env);
  
  if (!text.startsWith('/')) { await handleConversation(chatId, text, env, devicesData); return; }
  
  userStates.delete(chatId);
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().split('@')[0];
  const args = parts.slice(1);
  
  switch (command) {
    case '/start': await handleStart(chatId, text, env, devicesData); break;
    case '/help': await handleHelp(chatId, devicesData); break;
    case '/add': await handleAdd(chatId, args, env, devicesData); break;
    case '/remove': case '/delete': await handleRemove(chatId, args, env, devicesData); break;
    case '/list': await handleList(chatId, devicesData); break;
    case '/status': await handleStatus(chatId, env, devicesData); break;
    case '/check': await handleCheck(chatId, args, env); break;
    case '/settings': case '/caidat': await handleSettings(chatId, args, devicesData); break;
    case '/thresholds': case '/nguong': await handleThresholds(chatId, args, devicesData); break;
    case '/location': case '/vung': case '/vitri': await handleLocation(chatId, args, devicesData); break;
    default: await sendTelegram(chatId, `❓ Lệnh không hợp lệ. Gõ /help`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return corsResponse(null, { status: 204 });
    
    if (url.pathname === '/setup-webhook') { 
      const webhookUrl = url.origin + '/webhook'; 
      const response = await fetch(TELEGRAM_API + '/setWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhookUrl }) }); 
      return jsonResponse({ ...(await response.json()), webhookUrl }); 
    }
    
    if (url.pathname === '/webhook' && request.method === 'POST') { 
      try { ctx.waitUntil(handleUpdate(await request.json(), env)); return corsResponse('OK'); } 
      catch (e) { return corsResponse('Error', { status: 500 }); } 
    }
    
    if (url.pathname === '/test-api') { const devices = await fetchAllDevicesFromHA(env); return jsonResponse({ success: true, source: 'Direct_HA', count: devices.length, deviceIds: devices.slice(0, 10).map(d => d.deviceId) }); }
    
    if (url.pathname === '/trigger-notifications') { return jsonResponse({ success: true, ...(await processNotifications(env)), timestamp: getVietnamTime() }); }
    
    // API: Get device settings
    if (url.pathname === '/api/device-settings') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });
      const devicesData = await loadDevicesData(env);
      const device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      if (!device) return jsonResponse({ success: false, error: 'Device not found', deviceId });
      return jsonResponse({ success: true, deviceId: device.deviceId, location: device.location, settings: device.notifications, thresholds: device.thresholds || DEFAULT_THRESHOLDS, addedAt: device.addedAt });
    }
    
    // API: Update device settings
    if (url.pathname === '/api/update-settings' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { deviceId, notifications, location, thresholds, chatId } = body;
        if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });
        
        let devicesData = await loadDevicesData(env);
        let device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
        
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
          return jsonResponse({ success: false, error: 'Device not found. Please add device via Telegram Bot first with /add ' + deviceId });
        }
        
        if (notifications) device.notifications = { ...device.notifications, ...notifications };
        if (location) device.location = location;
        if (thresholds) {
          const oldThresholds = device.thresholds || { ...DEFAULT_THRESHOLDS };
          device.thresholds = { ...oldThresholds, ...thresholds };
          await clearAllThresholdAlerts(env, device.chatId, device.deviceId.toUpperCase());
        }
        
        await saveDevicesData(env, devicesData);
        return jsonResponse({ success: true, message: 'Settings updated', deviceId: device.deviceId, notifications: device.notifications, location: device.location, thresholds: device.thresholds, thresholdsReset: !!thresholds });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message });
      }
    }
    
    // API: Generate short deep link
    if (url.pathname === '/api/generate-deeplink') {
      const deviceId = url.searchParams.get('deviceId');
      const notifs = url.searchParams.get('notifications') || '111110';
      const bf = url.searchParams.get('bf') || '100';
      const bl = url.searchParams.get('bl') || '20';
      const pv = url.searchParams.get('pv') || '0';
      const gr = url.searchParams.get('gr') || '0';
      const ld = url.searchParams.get('ld') || '0';
      const loc = url.searchParams.get('loc') || 'hcm';
      
      if (!deviceId) return jsonResponse({ success: false, error: 'deviceId required' });
      
      const shortLink = `add_${deviceId.toUpperCase()}_${notifs}_${bf}_${bl}_${pv}_${gr}_${ld}_${loc}`;
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
    
    if (url.pathname === '/test-weather') {
      const location = url.searchParams.get('location') || 'TP. Ho Chi Minh';
      try { const weather = await getWeather(location); return jsonResponse({ success: !!weather, location, weather: weather || 'Failed', timestamp: getVietnamTime() }); }
      catch (e) { return jsonResponse({ success: false, error: e.message, location }); }
    }
    
    if (url.pathname === '/kv-status') { 
      const hasKV = !!env.BOT_KV; let count = 0, states = null; 
      if (hasKV) { try { const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }); states = await env.BOT_KV.get(KV_KEYS.DEVICE_STATES, { type: 'json' }); count = data?.length || 0; } catch (e) {} } 
      return jsonResponse({ kvBound: hasKV, usersCount: count, statesTracked: states ? Object.keys(states).length : 0, message: hasKV ? 'KV active' : 'KV not bound' }); 
    }
    
    if (url.pathname === '/kv-backup') { if (!env.BOT_KV) return jsonResponse({ error: 'KV not bound' }, 400); return jsonResponse({ backup: await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }), timestamp: new Date().toISOString() }); }
    
    if (url.pathname === '/health') { 
      const hasKV = !!env.BOT_KV; let count = 0; 
      if (hasKV) { const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }); count = data?.length || 0; } 
      return jsonResponse({ status: 'ok', version: '2.0', features: ['Voltage Alerts', 'Short Deep Link ≤64 chars', 'Web UI Sync', 'Smart Thresholds', 'Alert Once', 'Weather'], mode: 'Direct_HA', storage: hasKV ? 'KV_Persistent' : 'In-Memory', notifications: 'enabled', webAPI: 'enabled', users: count }); 
    }
    
    // Default HTML page
    return corsResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LightEarth Bot v2.0</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0f172a;color:#e2e8f0}h1{color:#22d3ee}h2{color:#a78bfa;border-bottom:1px solid #334155;padding-bottom:10px}ul{list-style:none;padding-left:0}li{padding:8px 0;border-bottom:1px solid #1e293b}a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}.badge{background:#059669;color:white;padding:3px 8px;border-radius:4px;font-size:12px;margin-right:5px}.new{background:#dc2626}.code{background:#1e293b;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:13px;display:block;margin:10px 0;overflow-x:auto}</style></head><body><h1>🤖 LightEarth Bot v2.0</h1><p><span class="badge new">⚡ VOLTAGE ALERTS</span><span class="badge">🔗 Deep Link ≤64 chars</span></p><h2>🔗 Deep Link Format v2.0:</h2><p>NEW v2.0 (52 chars):</p><code class="code">add_P250802210_111110_95_20_10_5_15_260_180_hcm</code><p>v1.9.0 format (44 chars) - backward compatible:</p><code class="code">add_P250802210_111110_95_20_10_5_15_hcm</code><h2>📋 Format: add_DEVICEID_NNNNNN_bf_bl_pv_gr_ld_vh_vl_loc</h2><ul><li><strong>NNNNNN</strong>: 6 bits thông báo (1=bật, 0=tắt)</li><li>Bit 1: morningGreeting | Bit 2: powerOutage | Bit 3: powerRestored</li><li>Bit 4: lowBattery | Bit 5: pvEnded | Bit 6: hourlyStatus</li><li><strong>bf_bl_pv_gr_ld</strong>: ngưỡng (batteryFull, batteryLow, pvDaily, gridUsage, loadDaily)</li><li><strong>vh_vl</strong>: voltageHigh, voltageLow (V) - 0 = TẮT</li><li><strong>loc</strong>: mã vùng 2-4 ký tự (hcm, hn, dng, tn, bd, dn, la...)</li></ul><h2>⚡ Voltage Alerts:</h2><ul><li>🔌 Điện áp cao (quá áp): Cảnh báo khi >= ngưỡng (VD: 260V)</li><li>🔌 Điện áp thấp (thấp áp): Cảnh báo khi <= ngưỡng (VD: 180V)</li></ul><h2>📱 Commands:</h2><ul><li>/start - 🚀 Bắt đầu + Deep Link</li><li>/help - 📋 Hướng dẫn</li><li>/add, /remove, /list - 📱 Quản lý thiết bị</li><li>/status, /check - 📊 Trạng thái</li><li>/settings - 🔔 Cài đặt thông báo</li><li>/thresholds - 🎯 Ngưỡng cảnh báo</li><li>/location - 📍 Vùng thời tiết</li></ul><h2>🔧 API & Debug:</h2><ul><li><a href="/health">/health</a> - Trạng thái hệ thống</li><li><a href="/kv-status">/kv-status</a> - Trạng thái KV</li><li><a href="/api/generate-deeplink?deviceId=P250802210&notifications=111110&bf=95&bl=20&pv=10&gr=5&ld=15&loc=hcm">/api/generate-deeplink</a> - Tạo short link</li><li><a href="/trigger-notifications">/trigger-notifications</a> - Test gửi thông báo</li></ul></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(processNotifications(env)); }
};
