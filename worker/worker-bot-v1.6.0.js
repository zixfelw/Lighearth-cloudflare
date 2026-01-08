// LightEarth Telegram Bot - Cloudflare Worker with KV Storage
// Version: 1.6.0 - Custom Alert Thresholds
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

const DEFAULT_DEVICES_DATA = [
  {"deviceId":"P250802210","chatId":5403648143,"addedAt":"2025-12-26 07:46:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250801055","chatId":273383744,"addedAt":"2025-12-23 20:28:53","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250716712","chatId":6881006811,"addedAt":"2025-12-24 09:11:07","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H241228031","chatId":6547314159,"addedAt":"2025-12-23 20:55:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250802171","chatId":5403648143,"addedAt":"2025-12-26 07:42:13","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250716712","chatId":8569714847,"addedAt":"2025-12-25 02:33:35","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250618052","chatId":6509043593,"addedAt":"2025-12-26 23:05:17","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H240828047","chatId":1164117060,"addedAt":"2025-12-25 06:20:34","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250422132","chatId":273383744,"addedAt":"2025-12-23 21:08:29","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250702133","chatId":1004431568,"addedAt":"2025-12-24 13:39:49","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H205411103","chatId":5743293519,"addedAt":"2025-12-24 15:17:13","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250430166","chatId":8575262765,"addedAt":"2025-12-24 20:26:32","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P240522014","chatId":273383744,"addedAt":"2025-12-23 21:00:40","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250802374","chatId":5403648143,"addedAt":"2025-12-26 07:46:25","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250617024","chatId":821968354,"addedAt":"2025-12-27 07:00:43","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250411103","chatId":273383744,"addedAt":"2025-12-24 17:49:28","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P124567","chatId":7559754910,"addedAt":"2025-12-24 11:20:20","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250522021","chatId":5668706760,"addedAt":"2025-12-26 16:26:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250714010","chatId":1708718555,"addedAt":"2025-12-29 10:04:38","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250927382","chatId":6460376019,"addedAt":"2025-12-26 12:26:20","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250218098","chatId":6121575600,"addedAt":"2025-12-24 22:27:33","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P240408033","chatId":1489084057,"addedAt":"2025-12-24 12:00:37","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250927423","chatId":973098063,"addedAt":"2025-12-24 20:27:46","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":false,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250725049","chatId":1708718555,"addedAt":"2025-12-29 10:05:34","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250321016","chatId":1139571134,"addedAt":"2025-12-24 13:58:49","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250619857","chatId":6178107645,"addedAt":"2025-12-25 07:24:59","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":false,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H240710141","chatId":8383416812,"addedAt":"2025-12-24 18:58:27","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"P250716681","chatId":5067831412,"addedAt":"2025-12-26 19:45:54","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250321003","chatId":8453287724,"addedAt":"2025-12-25 09:39:54","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250522065","chatId":6481143422,"addedAt":"2025-12-25 11:19:16","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H250411103","chatId":5743293519,"addedAt":"2025-12-24 17:54:10","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}},
  {"deviceId":"H241105043","chatId":6998300637,"addedAt":"2025-12-24 13:34:57","location":"TP. Ho Chi Minh","notifications":{"morningGreeting":true,"powerOutage":true,"powerRestored":true,"lowBattery":true,"pvEnded":true,"hourlyStatus":false}}
];

async function loadDevicesData(env) {
  if (!env.BOT_KV) return [...DEFAULT_DEVICES_DATA];
  try {
    const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' });
    if (data && Array.isArray(data)) return data;
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

function getVietnamTime() { return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', ''); }
function getVietnamHour() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).getHours(); }
function getVietnamDate() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0]; }
function getBatteryIcon(soc) { if (soc <= 5) return '🔴'; if (soc <= 20) return '🟠'; if (soc <= 50) return '🟡'; return '🟢'; }
function getUserDevices(devicesData, chatId) { return devicesData.filter(d => d.chatId === chatId); }

// Default thresholds for custom alerts
const DEFAULT_THRESHOLDS = {
  batteryFull: 100,      // % pin đầy (mặc định 100 = tắt)
  batteryLow: 20,        // % pin thấp (mặc định 20%)
  pvDaily: 0,            // kWh PV trong ngày (0 = tắt)
  gridUsage: 0,          // kWh điện EVN (0 = tắt)
  loadDaily: 0           // kWh tiêu thụ trong ngày (0 = tắt)
};

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
      devices.push({ deviceId, isOnline, hasGridPower, realtime: { batterySoc: Math.round(parseNum(getValue('battery_soc'))), pvPower: Math.round(parseNum(getValue('pv_power'))), batteryPower: Math.round(parseNum(getValue('battery_power'))), loadPower: Math.round(parseNum(getValue('total_load_power')) || parseNum(getValue('load_power'))), gridPower, acInputVoltage, temperature: Math.round(parseNum(getValue('device_temperature')) * 10) / 10 }, dailyEnergy: { pvDay: Math.round(parseNum(getValue('pv_today')) * 100) / 100, loadDay: Math.round((parseNum(getValue('total_load_today')) || parseNum(getValue('load_today'))) * 100) / 100, gridDay: Math.round((parseNum(getValue('grid_today')) || parseNum(getValue('grid_import_today'))) * 100) / 100 } });
    }
    return devices;
  } catch (e) { return []; }
}

async function getWeather(location) {
  const city = VIETNAM_CITIES[location];
  if (!city) return null;
  
  // Try Open-Meteo first
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=Asia/Ho_Chi_Minh&forecast_days=1`);
    if (response.ok) {
      const data = await response.json();
      const weatherCodes = { 
        0: '☀️ Troi quang', 1: '🌤️ It may', 2: '⛅ May mot phan', 3: '☁️ May nhieu', 
        45: '🌫️ Suong mu', 48: '🌫️ Suong mu dong', 
        51: '🌧️ Mua phun nhe', 53: '🌧️ Mua phun', 55: '🌧️ Mua phun day', 
        61: '🌧️ Mua nhe', 63: '🌧️ Mua vua', 65: '🌧️ Mua to', 
        80: '🌦️ Mua rao nhe', 81: '🌦️ Mua rao', 82: '🌦️ Mua rao to', 
        95: '⛈️ Dong', 96: '⛈️ Dong kem mua da' 
      };
      const vnHour = getVietnamHour();
      const currentTemp = data.hourly?.temperature_2m?.[vnHour] || data.daily.temperature_2m_max[0];
      const sunrise = data.daily?.sunrise?.[0]?.split('T')[1]?.slice(0, 5) || '06:00';
      const sunset = data.daily?.sunset?.[0]?.split('T')[1]?.slice(0, 5) || '18:00';
      const hourlyWeatherCode = data.hourly?.weather_code?.[vnHour];
      
      return { 
        description: weatherCodes[data.daily.weather_code[0]] || 'Khong ro',
        currentDescription: weatherCodes[hourlyWeatherCode] || weatherCodes[data.daily.weather_code[0]] || 'Khong ro',
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
  } catch (e) { /* fallback to wttr.in */ }
  
  // Fallback to wttr.in (no API key needed, generous limits)
  try {
    const cityQuery = location.replace(/\s+/g, '+');
    const response = await fetch(`https://wttr.in/${cityQuery}?format=j1`);
    if (response.ok) {
      const data = await response.json();
      const current = data.current_condition?.[0];
      const today = data.weather?.[0];
      const astronomy = today?.astronomy?.[0];
      
      if (current && today) {
        const weatherDesc = current.lang_vi?.[0]?.value || current.weatherDesc?.[0]?.value || 'Khong ro';
        const weatherEmoji = current.weatherCode == 113 ? '☀️' : 
                            current.weatherCode == 116 ? '🌤️' : 
                            current.weatherCode == 119 ? '☁️' : 
                            current.weatherCode >= 176 ? '🌧️' : '⛅';
        
        return {
          description: `${weatherEmoji} ${weatherDesc}`,
          currentDescription: `${weatherEmoji} ${weatherDesc}`,
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
  } catch (e) { /* return null */ }
  
  return null;
}

async function sendTelegram(chatId, text) {
  try { const response = await fetch(TELEGRAM_API + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }) }); return (await response.json()).ok; } catch (e) { return false; }
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
    const thresholds = userDevice.thresholds || DEFAULT_THRESHOLDS;
    const stateKey = `${chatId}_${deviceId}`;
    const haDevice = haDevices.find(d => d.deviceId.toUpperCase() === deviceId);
    if (!haDevice) continue;
    const prevState = previousStates[stateKey] || {};
    const rt = haDevice.realtime;
    const de = haDevice.dailyEnergy;
    const customLowBattery = thresholds.batteryLow || 20;
    const currentState = { 
      hasGridPower: haDevice.hasGridPower, 
      batterySoc: rt.batterySoc, 
      pvPower: rt.pvPower, 
      isLowBattery: rt.batterySoc <= customLowBattery, 
      hasPV: rt.pvPower > 50, 
      lastUpdate: Date.now(), 
      powerOutageTime: prevState.powerOutageTime || null,
      // Track daily values for threshold alerts
      pvDayNotified: prevState.pvDayNotified || false,
      gridDayNotified: prevState.gridDayNotified || false,
      loadDayNotified: prevState.loadDayNotified || false,
      batteryFullNotified: prevState.batteryFullNotified || false
    };

    if (prefs.powerOutage && prevState.hasGridPower === true && !currentState.hasGridPower) {
      currentState.powerOutageTime = Date.now();
      
      // Đánh giá tình trạng
      let statusMsg = '';
      const hoursLeft = Math.round((rt.batterySoc / 100) * (rt.loadPower > 200 ? 4 : 8)); // Ước tính giờ còn lại
      
      if (rt.pvPower > 100) {
        statusMsg = '\n💡 _PV dang hoat dong, ho tro cap dien_';
      } else if (rt.batterySoc >= 50) {
        statusMsg = `\n💡 _Pin du de su dung khoang ${hoursLeft}h_`;
      } else if (rt.batterySoc < 30) {
        statusMsg = '\n⚠️ _Canh bao: Pin thap, han che su dung!_';
      }
      
      notifications.push({ chatId, message: `⚡ *MAT DIEN LUOI EVN - ${deviceId}*\n\n🔴 Dien luoi da ngat!\n🔋 Pin: *${rt.batterySoc}%*\n☀️ PV: *${rt.pvPower}W*\n🏠 Tai su dung: *${rt.loadPower}W*${statusMsg}\n\n⏰ ${getVietnamTime()}` });
    }

    if (prefs.powerRestored && prevState.hasGridPower === false && currentState.hasGridPower) {
      let outageDuration = '';
      let durationMsg = '';
      if (prevState.powerOutageTime) { 
        const mins = Math.floor((Date.now() - prevState.powerOutageTime) / 60000); 
        outageDuration = mins >= 60 ? `${Math.floor(mins/60)} gio ${mins%60} phut` : `${mins} phut`; 
        durationMsg = `\n⏱️ Thoi gian mat dien: *${outageDuration}*`;
      }
      
      // Đánh giá tình trạng pin sau khi mất điện
      let batteryMsg = '';
      if (rt.batterySoc < 30) {
        batteryMsg = '\n📊 _Pin da giam nhieu, dang sac lai_';
      } else if (rt.batterySoc >= 80) {
        batteryMsg = '\n📊 _Pin van con tot!_';
      }
      
      notifications.push({ chatId, message: `✅ *CO DIEN LAI - ${deviceId}*\n\n🟢 Dien luoi da co!\n⚡ Grid: *${rt.gridPower}W*\n🔋 Pin: *${rt.batterySoc}%*${durationMsg}${batteryMsg}\n\n⏰ ${getVietnamTime()}` });
      currentState.powerOutageTime = null;
    }

    if (prefs.lowBattery && !prevState.isLowBattery && currentState.isLowBattery) {
      // Gợi ý hành động
      let tip = '';
      if (!haDevice.hasGridPower && rt.pvPower < 100) {
        tip = '\n⚠️ _Khong co dien luoi va PV, tiet kiem dien!_';
      } else if (rt.pvPower > 200) {
        tip = '\n💡 _PV dang sac pin, se hoi phuc som_';
      } else if (haDevice.hasGridPower) {
        tip = '\n💡 _Dien luoi dang sac pin_';
      } else {
        tip = '\n⚠️ _Han che su dung thiet bi lon!_';
      }
      
      notifications.push({ chatId, message: `🔋 *CANH BAO PIN THAP - ${deviceId}*\n\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* (nguong: ${customLowBattery}%)\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${haDevice.hasGridPower ? '🟢' : '🔴'}${tip}\n\n⏰ ${getVietnamTime()}` });
    }

    // === CUSTOM THRESHOLD ALERTS ===
    
    // 1. Battery Full Alert (chỉ thông báo 1 lần khi đạt ngưỡng)
    if (thresholds.batteryFull && thresholds.batteryFull < 100 && rt.batterySoc >= thresholds.batteryFull && !prevState.batteryFullNotified) {
      notifications.push({ chatId, message: `🔋 *PIN DAY - ${deviceId}*\n\n🟢 Pin da dat: *${rt.batterySoc}%* (nguong: ${thresholds.batteryFull}%)\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W*\n\n✅ Pin da sac day, san sang su dung!\n⏰ ${getVietnamTime()}` });
      currentState.batteryFullNotified = true;
    }
    // Reset khi pin xuống dưới ngưỡng - 5%
    if (rt.batterySoc < (thresholds.batteryFull || 100) - 5) {
      currentState.batteryFullNotified = false;
    }
    
    // 2. PV Daily Alert (thông báo khi đạt sản lượng PV trong ngày)
    if (thresholds.pvDaily && thresholds.pvDaily > 0 && de.pvDay >= thresholds.pvDaily && !prevState.pvDayNotified) {
      notifications.push({ chatId, message: `☀️ *DAT SAN LUONG PV - ${deviceId}*\n\n🎯 PV hom nay: *${de.pvDay} kWh* (nguong: ${thresholds.pvDaily} kWh)\n🔋 Pin: *${rt.batterySoc}%*\n☀️ PV hien tai: *${rt.pvPower}W*\n\n🎉 Tuyet voi! He thong PV hoat dong hieu qua!\n⏰ ${getVietnamTime()}` });
      currentState.pvDayNotified = true;
    }
    
    // 3. Grid Usage Alert (thông báo khi dùng quá nhiều điện EVN)
    if (thresholds.gridUsage && thresholds.gridUsage > 0 && de.gridDay >= thresholds.gridUsage && !prevState.gridDayNotified) {
      notifications.push({ chatId, message: `⚡ *SU DUNG DIEN EVN - ${deviceId}*\n\n⚠️ Dien EVN hom nay: *${de.gridDay} kWh* (nguong: ${thresholds.gridUsage} kWh)\n🔋 Pin: *${rt.batterySoc}%*\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n\n💡 _Can nhac tang su dung PV/Pin de tiet kiem_\n⏰ ${getVietnamTime()}` });
      currentState.gridDayNotified = true;
    }
    
    // 4. Load Daily Alert (thông báo khi tiêu thụ điện trong ngày đạt ngưỡng)
    if (thresholds.loadDaily && thresholds.loadDaily > 0 && de.loadDay >= thresholds.loadDaily && !prevState.loadDayNotified) {
      notifications.push({ chatId, message: `🏠 *TIEU THU DIEN TRONG NGAY - ${deviceId}*\n\n📊 Tieu thu hom nay: *${de.loadDay} kWh* (nguong: ${thresholds.loadDaily} kWh)\n☀️ PV: *${de.pvDay} kWh*\n⚡ Tu EVN: *${de.gridDay || 0} kWh*\n🔋 Pin: *${rt.batterySoc}%*\n\n💡 _Kiem tra cac thiet bi tieu thu nhieu dien_\n⏰ ${getVietnamTime()}` });
      currentState.loadDayNotified = true;
    }
    
    // Reset daily alerts at midnight (new day)
    if (vnHour === 0 && prevState.lastUpdate) {
      const prevDate = new Date(prevState.lastUpdate).toISOString().split('T')[0];
      if (prevDate !== vnDate) {
        currentState.pvDayNotified = false;
        currentState.gridDayNotified = false;
        currentState.loadDayNotified = false;
      }
    }

    if (prefs.pvEnded && prevState.hasPV && !currentState.hasPV && vnHour >= 16 && vnHour <= 19) {
      // Đánh giá tình trạng cho đêm
      let nightTip = '';
      if (rt.batterySoc >= 80) {
        nightTip = '\n✅ _Pin day du cho dem nay!_';
      } else if (rt.batterySoc >= 50) {
        nightTip = '\n💡 _Pin du dung, nen tiet kiem_';
      } else if (haDevice.hasGridPower) {
        nightTip = '\n⚡ _Dien luoi se ho tro qua dem_';
      } else {
        nightTip = '\n⚠️ _Pin thap, han che su dung!_';
      }
      
      notifications.push({ chatId, message: `🌇 *KET THUC NGAY NANG - ${deviceId}*\n\n☀️ PV: *${rt.pvPower}W* (da tat)\n🔋 Pin: *${rt.batterySoc}%*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${haDevice.hasGridPower ? '🟢' : '🔴'}${nightTip}\n\n🌙 Chuc buoi toi vui ve!\n⏰ ${getVietnamTime()}` });
    }

    if (prefs.morningGreeting && vnHour >= 6 && vnHour < 7) {
      const morningKey = `morning_${chatId}_${deviceId}`;
      if (await env.BOT_KV?.get(morningKey) !== vnDate) {
        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
        const locationName = userDevice.location || 'TP. Ho Chi Minh';
        
        // Tạo lời chào theo thời tiết
        let greeting = '🌅 *CHAO BUOI SANG!*';
        let weatherTip = '';
        let solarTip = '☀️ He thong san sang don nang!';
        
        if (weather) {
          // Gợi ý theo thời tiết
          if (weather.rainChance > 70) {
            weatherTip = '\n☔ _Kha nang mua cao, PV co the thap hon binh thuong_';
            solarTip = '🌧️ Ngay nhieu may, PV co the han che';
          } else if (weather.rainChance > 40) {
            weatherTip = '\n🌦️ _Co the co mua rao, theo doi PV_';
          } else if (weather.uvIndex >= 8) {
            weatherTip = '\n🔥 _Chi so UV cao, PV se hoat dong tot!_';
            solarTip = '☀️ Ngay nang dep, PV hoat dong toi uu!';
          } else if (weather.uvIndex >= 5) {
            solarTip = '☀️ Ngay nang vua, PV hoat dong tot!';
          }
          
          const weatherInfo = `\n\n🌤️ *Thoi tiet ${locationName}:*\n${weather.description}\n🌡️ Nhiet do: ${weather.tempMin}°C - ${weather.tempMax}°C\n💧 Do am: ${weather.humidity}%\n💨 Gio: ${weather.windSpeed} km/h\n🌧️ Kha nang mua: ${weather.rainChance}%\n☀️ UV: ${weather.uvIndex}\n🌅 Mat troi moc: ${weather.sunrise} | lan: ${weather.sunset}${weatherTip}`;
          
          notifications.push({ chatId, message: `${greeting}\n\n📱 *${deviceId}*\n🔋 Pin: ${rt.batterySoc}%\n${solarTip}${weatherInfo}\n\n⏰ ${getVietnamTime()}` });
        } else {
          notifications.push({ chatId, message: `${greeting}\n\n📱 *${deviceId}*\n🔋 Pin: ${rt.batterySoc}%\n${solarTip}\n\n⏰ ${getVietnamTime()}` });
        }
        
        if (env.BOT_KV) await env.BOT_KV.put(morningKey, vnDate, { expirationTtl: 86400 });
      }
    }

    if (prefs.hourlyStatus && vnHour >= 6 && vnHour <= 21) {
      const hourlyKey = `hourly_${chatId}_${deviceId}_${vnHour}`;
      if (await env.BOT_KV?.get(hourlyKey) !== vnDate) {
        const gridIcon = haDevice.hasGridPower ? '🟢' : '🔴';
        const weather = await getWeather(userDevice.location || 'TP. Ho Chi Minh');
        const locationName = userDevice.location || 'TP. Ho Chi Minh';
        
        // Tạo nhãn thời gian theo giờ
        let timeLabel = '';
        let emoji = '⏰';
        let tip = '';
        
        if (vnHour >= 6 && vnHour < 9) {
          timeLabel = 'SANG SOM';
          emoji = '🌅';
          tip = rt.pvPower > 100 ? '\n💡 _PV bat dau hoat dong!_' : '\n💡 _Cho nang len de PV hoat dong_';
        } else if (vnHour >= 9 && vnHour < 12) {
          timeLabel = 'BUOI SANG';
          emoji = '☀️';
          tip = rt.pvPower > 500 ? '\n🔥 _PV dang hoat dong manh!_' : '';
        } else if (vnHour >= 12 && vnHour < 14) {
          timeLabel = 'GIUA TRUA';
          emoji = '🌞';
          tip = rt.pvPower > 800 ? '\n🔥 _Dinh diem nang! PV max!_' : '';
        } else if (vnHour >= 14 && vnHour < 17) {
          timeLabel = 'BUOI CHIEU';
          emoji = '🌤️';
          tip = rt.pvPower < 200 && rt.pvPower > 0 ? '\n📉 _PV giam dan theo chieu_' : '';
        } else if (vnHour >= 17 && vnHour < 19) {
          timeLabel = 'CHIEU TOI';
          emoji = '🌇';
          tip = rt.pvPower < 50 ? '\n🌆 _PV sap ket thuc, chuyen sang pin/luoi_' : '';
        } else {
          timeLabel = 'BUOI TOI';
          emoji = '🌙';
          tip = '\n🌙 _Nghi ngoi va sac pin cho ngay mai!_';
        }
        
        // Đánh giá hiệu suất pin
        let batteryStatus = '';
        if (rt.batterySoc >= 80) batteryStatus = '🟢 Tuyet voi!';
        else if (rt.batterySoc >= 50) batteryStatus = '🟡 Tot';
        else if (rt.batterySoc >= 20) batteryStatus = '🟠 Trung binh';
        else batteryStatus = '🔴 Can sac!';
        
        // Thông tin thời tiết đầy đủ
        let weatherInfo = '';
        if (weather) {
          weatherInfo = `\n\n🌤️ *Thoi tiet ${locationName}:*\n${weather.currentDescription}\n🌡️ Nhiet do: ${weather.currentTemp}°C (${weather.tempMin}°C - ${weather.tempMax}°C)\n💧 Do am: ${weather.humidity}% | 💨 Gio: ${weather.windSpeed} km/h\n🌧️ Kha nang mua: ${weather.rainChance}%`;
          
          // Thêm thông tin theo buổi
          if (vnHour >= 6 && vnHour < 12) {
            // Buổi sáng: hiện UV
            weatherInfo += `\n☀️ Chi so UV: ${weather.uvIndex}`;
            if (weather.uvIndex >= 8) {
              weatherInfo += ` 🔥 _Cao - PV tot!_`;
            } else if (weather.uvIndex >= 5) {
              weatherInfo += ` _Trung binh_`;
            }
          } else if (vnHour >= 12 && vnHour < 17) {
            // Buổi chiều: UV + cảnh báo mưa
            weatherInfo += `\n☀️ Chi so UV: ${weather.uvIndex}`;
            if (weather.rainChance > 60) {
              weatherInfo += `\n⚠️ _Co the co mua chieu nay!_`;
            }
          } else {
            // Buổi tối: giờ mặt trời mọc ngày mai
            weatherInfo += `\n🌅 Mat troi moc: ${weather.sunrise} | lan: ${weather.sunset}`;
          }
        }
        
        const message = `${emoji} *${timeLabel} - ${deviceId}*\n\n☀️ PV: *${rt.pvPower}W*\n🔋 Pin: *${rt.batterySoc}%* ${batteryStatus}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${gridIcon}${weatherInfo}${tip}\n\n⏰ ${getVietnamTime()}`;
        
        notifications.push({ chatId, message });
        if (env.BOT_KV) await env.BOT_KV.put(hourlyKey, vnDate, { expirationTtl: 7200 });
      }
    }
    currentStates[stateKey] = currentState;
  }

  await saveDeviceStates(env, { ...previousStates, ...currentStates });
  for (const notif of notifications) { await sendTelegram(notif.chatId, notif.message); await new Promise(r => setTimeout(r, 100)); }
  return { sent: notifications.length, checked: devicesData.length, haDevices: haDevices.length };
}

async function handleHelp(chatId) {
  await sendTelegram(chatId, `🤖 *LightEarth Bot v1.6.0*\n💾 _Custom Alert Thresholds_\n\n📋 *Quan ly thiet bi:*\n/add <ID> - Them thiet bi\n/remove <ID> - Xoa thiet bi\n/list - Danh sach thiet bi\n\n📊 *Trang thai:*\n/status - Trang thai tat ca\n/check <ID> - Kiem tra 1 thiet bi\n\n⚙️ *Cai dat:*\n/settings - Cai dat thong bao\n/thresholds - Cai dat nguong canh bao\n/location - Cai dat vung thoi tiet\n\n🔔 *Thong bao tu dong:*\n• 🌅 Chao buoi sang + Thoi tiet\n• ⚡ Mat dien EVN / Co dien lai\n• 🔋 Pin day / Pin thap (tuy chinh %)\n• ☀️ San luong PV (tuy chinh kWh)\n• ⚡ Dien EVN (tuy chinh kWh)\n• 🏠 Tieu thu dien (tuy chinh kWh)\n• 🌇 Het nang / ⏰ Bao cao moi gio\n\n💡 Vi du: /check H250422132`);
}

// Handle /start with deep link payload from web app
// Format: /start add_DEVICEID_mg_po_pr_lb_pe_hs_loc_LOCATION
async function handleStartWithPayload(chatId, payload, env, devicesData) {
  // Parse payload: add_P250802210_mg_po_pr_lb_pe_loc_TP__Ho_Chi_Minh
  if (!payload.startsWith('add_')) {
    await handleHelp(chatId);
    return devicesData;
  }
  
  const parts = payload.substring(4).split('_loc_');
  const deviceAndSettings = parts[0];
  const locationEncoded = parts[1] || 'TP__Ho_Chi_Minh';
  
  // Extract device ID (first part before settings)
  const settingsParts = deviceAndSettings.split('_');
  const deviceId = settingsParts[0].toUpperCase();
  const settingCodes = settingsParts.slice(1);
  
  // Validate device ID
  if (!/^[HP]\d{6,}$/.test(deviceId)) {
    await sendTelegram(chatId, "❌ Device ID khong hop le!\n\nPhai bat dau bang H hoac P + so");
    return devicesData;
  }
  
  // Check if device exists in HA
  const haDevices = await fetchAllDevicesFromHA(env);
  if (!haDevices.some(d => d.deviceId?.toUpperCase() === deviceId)) {
    await sendTelegram(chatId, "❌ Thiet bi `" + deviceId + "` chua co trong he thong!\n\n📱 Tham gia Zalo:\n👉 https://zalo.me/g/kmzrgh433");
    return devicesData;
  }
  
  // Parse settings from codes: mg=morningGreeting, po=powerOutage, pr=powerRestored, lb=lowBattery, pe=pvEnded, hs=hourlyStatus
  const notifications = {
    morningGreeting: settingCodes.includes('mg'),
    powerOutage: settingCodes.includes('po'),
    powerRestored: settingCodes.includes('pr'),
    lowBattery: settingCodes.includes('lb'),
    pvEnded: settingCodes.includes('pe'),
    hourlyStatus: settingCodes.includes('hs')
  };
  
  // Parse location (replace __ with . and _ with space)
  let location = locationEncoded.replace(/__/g, '. ').replace(/_/g, ' ').trim();
  // Validate location exists in VIETNAM_CITIES, default to TP. Ho Chi Minh
  if (!VIETNAM_CITIES[location]) {
    location = 'TP. Ho Chi Minh';
  }
  
  // Check if already exists
  const existingIndex = devicesData.findIndex(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId);
  
  if (existingIndex !== -1) {
    // Update existing device settings
    devicesData[existingIndex].notifications = notifications;
    devicesData[existingIndex].location = location;
    await saveDevicesData(env, devicesData);
    
    const getIcon = (val) => val ? "✅" : "❌";
    await sendTelegram(chatId, `✅ *Da cap nhat thiet bi!*\n\n📱 Thiet bi: \`${deviceId}\`\n📍 Vung: ${location}\n\n🔔 *Cai dat thong bao:*\n${getIcon(notifications.morningGreeting)} 🌅 Chao buoi sang\n${getIcon(notifications.powerOutage)} ⚡ Mat dien EVN\n${getIcon(notifications.powerRestored)} ✅ Co dien lai\n${getIcon(notifications.lowBattery)} 🔋 Pin yeu\n${getIcon(notifications.pvEnded)} 🌇 Het nang\n${getIcon(notifications.hourlyStatus)} ⏰ Bao cao moi gio\n\n📝 Dung /settings de thay doi`);
  } else {
    // Add new device with settings
    devicesData.push({
      deviceId: deviceId,
      chatId: chatId,
      addedAt: getVietnamTime(),
      location: location,
      notifications: notifications
    });
    await saveDevicesData(env, devicesData);
    
    const getIcon = (val) => val ? "✅" : "❌";
    await sendTelegram(chatId, `✅ *Da them thiet bi tu Web!*\n\n📱 Thiet bi: \`${deviceId}\`\n📍 Vung: ${location}\n\n🔔 *Cai dat thong bao:*\n${getIcon(notifications.morningGreeting)} 🌅 Chao buoi sang\n${getIcon(notifications.powerOutage)} ⚡ Mat dien EVN\n${getIcon(notifications.powerRestored)} ✅ Co dien lai\n${getIcon(notifications.lowBattery)} 🔋 Pin yeu\n${getIcon(notifications.pvEnded)} 🌇 Het nang\n${getIcon(notifications.hourlyStatus)} ⏰ Bao cao moi gio\n\n📝 Dung /settings de thay doi`);
  }
  
  return devicesData;
}

async function handleAdd(chatId, args, env, devicesData) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'add_device' }); await sendTelegram(chatId, "➕ *Them thiet bi*\n\nNhap Device ID:"); return devicesData; }
  const deviceId = args[0].toUpperCase();
  if (!/^[HP]\d{6,}$/.test(deviceId)) { await sendTelegram(chatId, "❌ Device ID khong hop le!\n\nPhai bat dau bang H hoac P + so"); return devicesData; }
  const haDevices = await fetchAllDevicesFromHA(env);
  if (!haDevices.some(d => d.deviceId?.toUpperCase() === deviceId)) { await sendTelegram(chatId, "❌ Thiet bi `" + deviceId + "` chua co trong he thong!\n\n📱 Tham gia Zalo:\n👉 https://zalo.me/g/kmzrgh433"); return devicesData; }
  const result = await addDevice(env, devicesData, chatId, deviceId);
  await sendTelegram(chatId, result.success ? "✅ Da them `" + deviceId + "`!\n\n🔔 Ban se nhan thong bao khi:\n• ⚡ Mat dien\n• ✅ Co dien lai\n• 🔋 Pin yeu\n• 🌇 Het PV\n\nDung /settings de tuy chinh\nDung /location de chon vung thoi tiet" : "ℹ️ Thiet bi da co trong danh sach.");
  return result.devicesData;
}

async function handleRemove(chatId, args, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, "📋 Ban chua co thiet bi nao."); return devicesData; }
  if (args.length === 0) { let list = "➖ *Xoa thiet bi*\n\n"; userDevices.forEach((d, i) => { list += (i + 1) + ". `" + d.deviceId + "`\n"; }); list += "\nNhap so hoac Device ID:"; userStates.set(chatId, { waiting: 'remove_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list); return devicesData; }
  let deviceId = args[0];
  if (/^\d+$/.test(deviceId)) { const idx = parseInt(deviceId) - 1; if (idx >= 0 && idx < userDevices.length) deviceId = userDevices[idx].deviceId; }
  const result = await removeDevice(env, devicesData, chatId, deviceId);
  await sendTelegram(chatId, result.success ? "✅ Da xoa `" + deviceId.toUpperCase() + "`" : "❌ Khong tim thay");
  return result.devicesData;
}

async function handleList(chatId, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, "📋 *Danh sach*\n\n_(Chua co thiet bi)_\n\nThem: /add <ID>"); return; }
  let msg = "📋 *Danh sach thiet bi*\n\n";
  userDevices.forEach((d, i) => { msg += (i + 1) + ". `" + d.deviceId + "` 📍 " + (d.location || "Chua dat") + "\n"; });
  await sendTelegram(chatId, msg);
}

async function handleStatus(chatId, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, "📊 *Trang thai*\n\n_(Chua co thiet bi)_\n\nThem: /add"); return; }
  const haDevices = await fetchAllDevicesFromHA(env);
  let msg = "📊 *Trang thai thiet bi*\n\n";
  for (const userDevice of userDevices) {
    const haDevice = haDevices.find(d => d.deviceId?.toUpperCase() === userDevice.deviceId.toUpperCase());
    if (haDevice?.realtime) { const rt = haDevice.realtime; msg += "📱 *" + userDevice.deviceId + "* " + (haDevice.isOnline ? "🟢" : "🔴") + "\n   ☀️ PV: " + rt.pvPower + "W\n   " + getBatteryIcon(rt.batterySoc) + " Pin: " + rt.batterySoc + "%\n   🏠 Load: " + rt.loadPower + "W\n   ⚡ Grid: " + rt.gridPower + "W " + (haDevice.hasGridPower ? "🟢" : "🔴") + "\n\n"; }
    else { msg += "📱 *" + userDevice.deviceId + "*\n   ⚠️ _Khong co du lieu_\n\n"; }
  }
  msg += "⏰ " + getVietnamTime();
  await sendTelegram(chatId, msg);
}

async function handleCheck(chatId, args, env) {
  if (args.length === 0) { userStates.set(chatId, { waiting: 'check_device' }); await sendTelegram(chatId, "🔍 *Kiem tra*\n\nNhap Device ID:"); return; }
  const deviceId = args[0].toUpperCase();
  const haDevices = await fetchAllDevicesFromHA(env);
  const device = haDevices.find(d => d.deviceId?.toUpperCase() === deviceId);
  if (!device) { await sendTelegram(chatId, "❌ Khong tim thay `" + deviceId + "`"); return; }
  const rt = device.realtime, de = device.dailyEnergy;
  await sendTelegram(chatId, "📊 *" + deviceId + "* " + (device.isOnline ? "🟢 Online" : "🔴 Offline") + "\n\n☀️ PV: *" + rt.pvPower + "W*\n" + getBatteryIcon(rt.batterySoc) + " Pin: *" + rt.batterySoc + "%* (" + rt.batteryPower + "W)\n🏠 Load: *" + rt.loadPower + "W*\n⚡ Grid: *" + rt.gridPower + "W* " + (device.hasGridPower ? "🟢 Co dien" : "🔴 Mat dien") + "\n🌡️ Nhiet do: *" + rt.temperature + "°C*\n\n📈 Hom nay: PV " + de.pvDay + "kWh | Load " + de.loadDay + "kWh\n\n⏰ " + getVietnamTime());
}

async function handleSettings(chatId, args, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, "⚙️ *Cai dat*\n\n_(Chua co thiet bi)_\n\nThem: /add"); return; }
  if (args.length === 0 && userDevices.length > 1) { let list = "⚙️ *Cai dat thong bao*\n\nChon thiet bi:\n\n"; userDevices.forEach((d, i) => { list += (i + 1) + ". `" + d.deviceId + "`\n"; }); list += "\nNhap so hoac Device ID:"; userStates.set(chatId, { waiting: 'settings_device', devices: userDevices.map(d => d.deviceId) }); await sendTelegram(chatId, list); return; }
  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { await sendTelegram(chatId, "❌ Khong tim thay thiet bi"); return; }
  const prefs = device.notifications || {};
  const getIcon = (val) => val ? "✅" : "❌";
  userStates.set(chatId, { waiting: 'settings_toggle', deviceId: device.deviceId });
  await sendTelegram(chatId, `⚙️ *Cai dat thong bao*\n📱 Thiet bi: \`${device.deviceId}\`\n\n1. ${getIcon(prefs.morningGreeting)} 🌅 Chao buoi sang + Thoi tiet\n2. ${getIcon(prefs.powerOutage)} ⚡ Mat dien luoi EVN\n3. ${getIcon(prefs.powerRestored)} ✅ Co dien lai\n4. ${getIcon(prefs.lowBattery)} 🔋 Pin yeu (<20%)\n5. ${getIcon(prefs.pvEnded)} 🌇 Het PV (chuyen xai pin)\n6. ${getIcon(prefs.hourlyStatus)} ⏰ Bao cao moi gio (6h-21h)\n\n📝 *Cach doi:* Go so (1-6) de bat/tat\nGo \`0\` de thoat`);
}

async function handleLocation(chatId, args, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { await sendTelegram(chatId, "📍 *Cai dat vung*\n\n_(Chua co thiet bi)_\n\nThem: /add"); return; }
  
  // Show device list with current locations
  let list = "📍 *Cai dat vung thoi tiet*\n\nChon thiet bi de thay doi vung:\n\n";
  userDevices.forEach((d, i) => { 
    list += `${i + 1}. \`${d.deviceId}\` - ${d.location || "Chua dat"}\n`; 
  });
  list += "\n📝 Nhap so de chon thiet bi:";
  userStates.set(chatId, { waiting: 'location_select_device', devices: userDevices.map(d => ({ id: d.deviceId, location: d.location })) });
  await sendTelegram(chatId, list);
}

// Handle /thresholds - Custom alert thresholds
async function handleThresholds(chatId, args, env, devicesData) {
  const userDevices = getUserDevices(devicesData, chatId);
  if (userDevices.length === 0) { 
    await sendTelegram(chatId, "⚡ *Cai dat nguong canh bao*\n\n_(Chua co thiet bi)_\n\nThem: /add"); 
    return devicesData; 
  }
  
  if (args.length === 0 && userDevices.length > 1) { 
    let list = "⚡ *Cai dat nguong canh bao*\n\nChon thiet bi:\n\n"; 
    userDevices.forEach((d, i) => { list += (i + 1) + ". `" + d.deviceId + "`\n"; }); 
    list += "\nNhap so hoac Device ID:"; 
    userStates.set(chatId, { waiting: 'thresholds_device', devices: userDevices.map(d => d.deviceId) }); 
    await sendTelegram(chatId, list); 
    return devicesData; 
  }
  
  const deviceId = args[0] || userDevices[0].deviceId;
  const device = userDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) { 
    await sendTelegram(chatId, "❌ Khong tim thay thiet bi"); 
    return devicesData; 
  }
  
  // Initialize thresholds if not exist
  if (!device.thresholds) {
    device.thresholds = { ...DEFAULT_THRESHOLDS };
    await saveDevicesData(env, devicesData);
  }
  
  const th = device.thresholds;
  const getStatus = (val, unit, offVal = 0) => val > offVal ? `*${val}${unit}*` : "_TAT_";
  
  userStates.set(chatId, { waiting: 'thresholds_select', deviceId: device.deviceId });
  await sendTelegram(chatId, `⚡ *Cai dat nguong canh bao*\n📱 Thiet bi: \`${device.deviceId}\`\n\n*Nguong hien tai:*\n1. 🔋 Pin DAY: ${getStatus(th.batteryFull, '%', 99)}\n2. 🪫 Pin THAP: ${getStatus(th.batteryLow, '%')}\n3. ☀️ San luong PV: ${getStatus(th.pvDaily, ' kWh')}\n4. ⚡ Dien EVN: ${getStatus(th.gridUsage, ' kWh')}\n5. 🏠 Tieu thu/ngay: ${getStatus(th.loadDaily, ' kWh')}\n\n📝 *Cach chinh:*\nGo so (1-5) de chon loai\nGo \`0\` de thoat\n\n💡 _Dat nguong = 0 de TAT canh bao_`);
  
  return devicesData;
}

// Update device thresholds
async function updateDeviceThreshold(env, devicesData, chatId, deviceId, thresholdType, value) {
  const device = devicesData.find(d => d.chatId === chatId && d.deviceId.toUpperCase() === deviceId.toUpperCase());
  if (!device) return null;
  
  if (!device.thresholds) {
    device.thresholds = { ...DEFAULT_THRESHOLDS };
  }
  
  device.thresholds[thresholdType] = value;
  await saveDevicesData(env, devicesData);
  return { thresholdType, newValue: value };
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
      if (text === '0') { await sendTelegram(chatId, "✅ Da thoat cai dat thong bao."); return { handled: true, devicesData }; }
      const settingNum = parseInt(text);
      if (settingNum >= 1 && settingNum <= 6) { 
        const result = await updateDeviceSettings(env, devicesData, chatId, state.deviceId, settingNum); 
        if (result) { 
          const settingNames = { morningGreeting: "🌅 Chao buoi sang", powerOutage: "⚡ Mat dien", powerRestored: "✅ Co dien lai", lowBattery: "🔋 Pin yeu", pvEnded: "🌇 Het PV", hourlyStatus: "⏰ Bao cao moi gio" }; 
          await sendTelegram(chatId, `✅ *Da cap nhat!*\n\n${settingNames[result.setting]}: ${result.newValue ? "✅ BAT" : "❌ TAT"}\n\nGo so khac de tiep tuc hoac \`0\` de thoat.`); 
          userStates.set(chatId, { waiting: 'settings_toggle', deviceId: state.deviceId }); 
        } 
      } else { 
        await sendTelegram(chatId, "❌ Vui long nhap so tu 1-6, hoac `0` de thoat."); 
        userStates.set(chatId, state); 
      }
      return { handled: true, devicesData };
    
    // Location flow - Step 1: Select device
    case 'location_select_device':
      const devIdx = parseInt(text) - 1;
      if (devIdx >= 0 && devIdx < state.devices.length) {
        const selectedDev = state.devices[devIdx];
        userStates.set(chatId, { waiting: 'location_select_region', deviceId: selectedDev.id, currentLocation: selectedDev.location });
        await sendTelegram(chatId, `📍 *Thiet bi: ${selectedDev.id}*\n📌 Vung hien tai: *${selectedDev.location || "Chua dat"}*\n\nChon mien:\n1️⃣ Mien Nam\n2️⃣ Mien Trung\n3️⃣ Tay Nguyen\n4️⃣ Mien Bac\n\n📝 Nhap so (1-4):`);
      } else {
        await sendTelegram(chatId, "❌ Lua chon khong hop le. Go /location de thu lai.");
      }
      return { handled: true, devicesData };
    
    // Location flow - Step 2: Select region
    case 'location_select_region':
      const regionNum = parseInt(text);
      if (regionNum >= 1 && regionNum <= 4) { 
        const regionMap = { 1: "Mien Nam", 2: "Mien Trung", 3: "Tay Nguyen", 4: "Mien Bac" }; 
        const region = regionMap[regionNum]; 
        const cities = Object.entries(VIETNAM_CITIES).filter(([_, d]) => d.region === region).map(([name]) => name).sort(); 
        let message = `📍 *${region}*\n📱 Thiet bi: \`${state.deviceId}\`\n\nChon tinh/thanh pho:\n\n`; 
        cities.forEach((city, i) => { message += `${i + 1}. ${city}\n`; }); 
        message += `\n📝 Nhap so (1-${cities.length}) hoac ten tinh:`; 
        userStates.set(chatId, { waiting: 'location_select_city', deviceId: state.deviceId, cities }); 
        await sendTelegram(chatId, message); 
      } else { 
        await sendTelegram(chatId, "❌ Vui long nhap so tu 1-4."); 
        userStates.set(chatId, state); 
      }
      return { handled: true, devicesData };
    
    // Location flow - Step 3: Select city
    case 'location_select_city':
      let selectedCity = null;
      if (/^\d+$/.test(text) && state.cities) { 
        const idx = parseInt(text) - 1; 
        if (idx >= 0 && idx < state.cities.length) selectedCity = state.cities[idx]; 
      } else { 
        selectedCity = Object.keys(VIETNAM_CITIES).find(c => c.toLowerCase().includes(text.toLowerCase())); 
      }
      if (selectedCity && VIETNAM_CITIES[selectedCity]) { 
        await updateSingleDeviceLocation(env, devicesData, chatId, state.deviceId, selectedCity); 
        await sendTelegram(chatId, `✅ *Da cap nhat!*\n\n📱 Thiet bi: \`${state.deviceId}\`\n📍 Vung: *${selectedCity}*\n\n🌤️ Thong bao chao buoi sang se kem du bao thoi tiet cho khu vuc nay.\n\n💡 Go /location de tiep tuc chinh thiet bi khac.`); 
      } else { 
        await sendTelegram(chatId, "❌ Khong tim thay tinh/thanh pho. Go /location de thu lai."); 
      }
      return { handled: true, devicesData };
    
    // Thresholds flow - Step 1: Select device (multi-device)
    case 'thresholds_device':
      let thDeviceId = text;
      if (/^\d+$/.test(text) && state.devices) { 
        const idx = parseInt(text) - 1; 
        if (idx >= 0 && idx < state.devices.length) thDeviceId = state.devices[idx]; 
      }
      return { handled: true, devicesData: await handleThresholds(chatId, [thDeviceId], env, devicesData) };
    
    // Thresholds flow - Step 2: Select threshold type
    case 'thresholds_select':
      if (text === '0') { 
        await sendTelegram(chatId, "✅ Da thoat cai dat nguong canh bao."); 
        return { handled: true, devicesData }; 
      }
      const thType = parseInt(text);
      if (thType >= 1 && thType <= 5) {
        const thMap = { 1: 'batteryFull', 2: 'batteryLow', 3: 'pvDaily', 4: 'gridUsage', 5: 'loadDaily' };
        const thNames = { 1: '🔋 Pin DAY (%)', 2: '🪫 Pin THAP (%)', 3: '☀️ San luong PV (kWh)', 4: '⚡ Dien EVN (kWh)', 5: '🏠 Tieu thu/ngay (kWh)' };
        const thHints = { 
          1: 'Nhap % pin de thong bao khi day (80-100)\nVi du: 90 = thong bao khi pin >= 90%\nNhap 100 de TAT', 
          2: 'Nhap % pin de thong bao khi thap (10-50)\nVi du: 20 = thong bao khi pin <= 20%', 
          3: 'Nhap so kWh PV trong ngay\nVi du: 5 = thong bao khi PV dat 5kWh\nNhap 0 de TAT', 
          4: 'Nhap so kWh dien EVN\nVi du: 2 = thong bao khi dung 2kWh tu EVN\nNhap 0 de TAT', 
          5: 'Nhap so kWh tieu thu/ngay\nVi du: 10 = thong bao khi dung 10kWh\nNhap 0 de TAT' 
        };
        userStates.set(chatId, { waiting: 'thresholds_input', deviceId: state.deviceId, thresholdType: thMap[thType], thresholdName: thNames[thType] });
        await sendTelegram(chatId, `⚡ *${thNames[thType]}*\n📱 Thiet bi: \`${state.deviceId}\`\n\n${thHints[thType]}\n\n📝 Nhap gia tri hoac \`0\` de TAT:`);
      } else {
        await sendTelegram(chatId, "❌ Vui long nhap so tu 1-5, hoac `0` de thoat.");
        userStates.set(chatId, state);
      }
      return { handled: true, devicesData };
    
    // Thresholds flow - Step 3: Input value
    case 'thresholds_input':
      const value = parseFloat(text);
      if (isNaN(value) || value < 0) {
        await sendTelegram(chatId, "❌ Gia tri khong hop le. Nhap so >= 0:");
        userStates.set(chatId, state);
        return { handled: true, devicesData };
      }
      
      const result = await updateDeviceThreshold(env, devicesData, chatId, state.deviceId, state.thresholdType, value);
      if (result) {
        const statusMsg = value === 0 ? "❌ TAT" : (state.thresholdType === 'batteryFull' && value >= 100 ? "❌ TAT" : `✅ ${value}${state.thresholdType.includes('battery') ? '%' : ' kWh'}`);
        await sendTelegram(chatId, `✅ *Da cap nhat!*\n\n${state.thresholdName}: ${statusMsg}\n\n📝 Go /thresholds de tiep tuc chinh nguong khac.`);
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
    case '/start': 
      if (args.length > 0 && args[0].startsWith('add_')) {
        await handleStartWithPayload(chatId, args[0], env, devicesData);
      } else {
        await handleHelp(chatId);
      }
      break;
    case '/help': await handleHelp(chatId); break;
    case '/add': await handleAdd(chatId, args, env, devicesData); break;
    case '/remove': case '/delete': await handleRemove(chatId, args, env, devicesData); break;
    case '/list': await handleList(chatId, devicesData); break;
    case '/status': await handleStatus(chatId, env, devicesData); break;
    case '/check': await handleCheck(chatId, args, env); break;
    case '/settings': case '/caidat': await handleSettings(chatId, args, devicesData); break;
    case '/location': case '/vung': case '/vitri': await handleLocation(chatId, args, devicesData); break;
    case '/thresholds': case '/nguong': await handleThresholds(chatId, args, env, devicesData); break;
    default: await sendTelegram(chatId, "❓ Lenh khong hop le. Go /help");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return corsResponse(null, { status: 204 });
    if (url.pathname === '/setup-webhook') { const webhookUrl = url.origin + '/webhook'; const response = await fetch(TELEGRAM_API + '/setWebhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhookUrl }) }); return jsonResponse({ ...(await response.json()), webhookUrl }); }
    if (url.pathname === '/webhook' && request.method === 'POST') { try { ctx.waitUntil(handleUpdate(await request.json(), env)); return corsResponse('OK'); } catch (e) { return corsResponse('Error', { status: 500 }); } }
    if (url.pathname === '/test-api') { const devices = await fetchAllDevicesFromHA(env); return jsonResponse({ success: true, source: 'Direct_HA', count: devices.length, deviceIds: devices.slice(0, 10).map(d => d.deviceId) }); }
    if (url.pathname === '/trigger-notifications') { return jsonResponse({ success: true, ...(await processNotifications(env)), timestamp: getVietnamTime() }); }
    
    // API: Get device settings for web interface
    if (url.pathname === '/api/device-settings') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        return jsonResponse({ success: false, error: 'deviceId required' });
      }
      
      const devicesData = await loadDevicesData(env);
      const device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      
      if (!device) {
        return jsonResponse({ success: false, error: 'Device not found', deviceId });
      }
      
      return jsonResponse({
        success: true,
        deviceId: device.deviceId,
        location: device.location,
        settings: device.notifications,
        thresholds: device.thresholds || DEFAULT_THRESHOLDS,
        addedAt: device.addedAt
      });
    }
    
    // API: Update device settings from web interface
    if (url.pathname === '/api/update-settings' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { deviceId, notifications, location, thresholds } = body;
        
        if (!deviceId) {
          return jsonResponse({ success: false, error: 'deviceId required' });
        }
        
        const devicesData = await loadDevicesData(env);
        const device = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
        
        if (!device) {
          return jsonResponse({ success: false, error: 'Device not found. Please add device via Telegram Bot first with /add ' + deviceId });
        }
        
        // Update settings
        if (notifications) {
          device.notifications = { ...device.notifications, ...notifications };
        }
        if (location) {
          device.location = location;
        }
        // Update thresholds
        if (thresholds) {
          if (!device.thresholds) device.thresholds = { ...DEFAULT_THRESHOLDS };
          device.thresholds = { ...device.thresholds, ...thresholds };
        }
        
        await saveDevicesData(env, devicesData);
        
        return jsonResponse({
          success: true,
          message: 'Settings updated',
          deviceId: device.deviceId,
          notifications: device.notifications,
          thresholds: device.thresholds || DEFAULT_THRESHOLDS,
          location: device.location
        });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message });
      }
    }
    
    // Debug weather API
    if (url.pathname === '/test-weather') {
      const location = url.searchParams.get('location') || 'TP. Ho Chi Minh';
      try {
        const weather = await getWeather(location);
        return jsonResponse({ 
          success: !!weather, 
          location,
          weather: weather || 'Failed - both APIs unavailable',
          timestamp: getVietnamTime()
        });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message, location });
      }
    }
    
    // Test all notification types for a specific device
    if (url.pathname === '/test-all-notifications') {
      const deviceId = url.searchParams.get('device') || 'P250801055';
      const devicesData = await loadDevicesData(env);
      const userDevice = devicesData.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      
      if (!userDevice) {
        return jsonResponse({ success: false, error: `Device ${deviceId} not found in user data` });
      }
      
      const chatId = userDevice.chatId;
      const locationName = userDevice.location || 'TP. Ho Chi Minh';
      const haDevices = await fetchAllDevicesFromHA(env);
      const haDevice = haDevices.find(d => d.deviceId.toUpperCase() === deviceId.toUpperCase());
      
      if (!haDevice) {
        return jsonResponse({ success: false, error: `Device ${deviceId} not found in Home Assistant` });
      }
      
      const rt = haDevice.realtime;
      const weather = await getWeather(locationName);
      const results = [];
      
      // 1. Test Morning Greeting
      let weatherInfo = '';
      let solarTip = '☀️ Ngay nang dep, PV hoat dong toi uu!';
      if (weather) {
        weatherInfo = `\n\n🌤️ *Thoi tiet ${locationName}:*\n${weather.description}\n🌡️ Nhiet do: ${weather.tempMin}°C - ${weather.tempMax}°C\n💧 Do am: ${weather.humidity}%\n💨 Gio: ${weather.windSpeed} km/h\n🌧️ Kha nang mua: ${weather.rainChance}%\n☀️ UV: ${weather.uvIndex}\n🌅 Mat troi moc: ${weather.sunrise} | lan: ${weather.sunset}`;
        if (weather.rainChance > 70) {
          weatherInfo += '\n☔ _Kha nang mua cao, PV co the thap hon binh thuong_';
          solarTip = '🌧️ Ngay nhieu may, PV co the han che';
        } else if (weather.uvIndex >= 8) {
          weatherInfo += '\n🔥 _Chi so UV cao, PV se hoat dong tot!_';
        }
      }
      const msg1 = `🌅 *CHAO BUOI SANG!*\n\n📱 *${deviceId}*\n🔋 Pin: ${rt.batterySoc}%\n${solarTip}${weatherInfo}\n\n⏰ ${getVietnamTime()}`;
      results.push({ type: 'morning_greeting', sent: await sendTelegram(chatId, msg1) });
      await new Promise(r => setTimeout(r, 500));
      
      // 2. Test Power Outage
      const hoursLeft = Math.round((rt.batterySoc / 100) * 6);
      let statusMsg = rt.pvPower > 100 ? '\n💡 _PV dang hoat dong, ho tro cap dien_' : `\n💡 _Pin du de su dung khoang ${hoursLeft}h_`;
      const msg2 = `⚡ *MAT DIEN LUOI EVN - ${deviceId}*\n\n🔴 Dien luoi da ngat!\n🔋 Pin: *${rt.batterySoc}%*\n☀️ PV: *${rt.pvPower}W*\n🏠 Tai su dung: *${rt.loadPower}W*${statusMsg}\n\n⏰ ${getVietnamTime()}`;
      results.push({ type: 'power_outage', sent: await sendTelegram(chatId, msg2) });
      await new Promise(r => setTimeout(r, 500));
      
      // 3. Test Power Restored
      const msg3 = `✅ *CO DIEN LAI - ${deviceId}*\n\n🟢 Dien luoi da co!\n⚡ Grid: *${rt.gridPower}W*\n🔋 Pin: *${rt.batterySoc}%*\n⏱️ Thoi gian mat dien: *45 phut*\n📊 _Pin van con tot!_\n\n⏰ ${getVietnamTime()}`;
      results.push({ type: 'power_restored', sent: await sendTelegram(chatId, msg3) });
      await new Promise(r => setTimeout(r, 500));
      
      // 4. Test Low Battery
      const msg4 = `🚭 *CANH BAO PIN YEU - ${deviceId}*\n\n🟠 Pin: *18%* - CAN SAC!\n☀️ PV: *${rt.pvPower}W*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${haDevice.hasGridPower ? '🟢' : '🔴'}\n💡 _Dien luoi dang sac pin_\n\n⏰ ${getVietnamTime()}`;
      results.push({ type: 'low_battery', sent: await sendTelegram(chatId, msg4) });
      await new Promise(r => setTimeout(r, 500));
      
      // 5. Test PV Ended
      const nightTip = rt.batterySoc >= 80 ? '\n✅ _Pin day du cho dem nay!_' : '\n💡 _Pin du dung, nen tiet kiem_';
      const msg5 = `🌇 *KET THUC NGAY NANG - ${deviceId}*\n\n☀️ PV: *0W* (da tat)\n🔋 Pin: *${rt.batterySoc}%*\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${haDevice.hasGridPower ? '🟢' : '🔴'}${nightTip}\n\n🌙 Chuc buoi toi vui ve!\n⏰ ${getVietnamTime()}`;
      results.push({ type: 'pv_ended', sent: await sendTelegram(chatId, msg5) });
      await new Promise(r => setTimeout(r, 500));
      
      // 6. Test Hourly Status (multiple time periods) - với thời tiết đầy đủ
      const hourlyTests = [
        { hour: 7, label: 'SANG SOM', emoji: '🌅', tip: '\n💡 _PV bat dau hoat dong!_', period: 'morning' },
        { hour: 12, label: 'GIUA TRUA', emoji: '🌞', tip: '\n🔥 _Dinh diem nang! PV max!_', period: 'noon' },
        { hour: 17, label: 'CHIEU TOI', emoji: '🌇', tip: '\n🌆 _PV sap ket thuc, chuyen sang pin/luoi_', period: 'afternoon' },
        { hour: 20, label: 'BUOI TOI', emoji: '🌙', tip: '\n🌙 _Nghi ngoi va sac pin cho ngay mai!_', period: 'night' }
      ];
      
      for (const h of hourlyTests) {
        let batteryStatus = rt.batterySoc >= 80 ? '🟢 Tuyet voi!' : rt.batterySoc >= 50 ? '🟡 Tot' : '🟠 Trung binh';
        let weatherInfoHourly = '';
        if (weather) {
          weatherInfoHourly = `\n\n🌤️ *Thoi tiet ${locationName}:*\n${weather.currentDescription}\n🌡️ Nhiet do: ${weather.currentTemp}°C (${weather.tempMin}°C - ${weather.tempMax}°C)\n💧 Do am: ${weather.humidity}% | 💨 Gio: ${weather.windSpeed} km/h\n🌧️ Kha nang mua: ${weather.rainChance}%`;
          
          if (h.period === 'morning' || h.period === 'noon') {
            weatherInfoHourly += `\n☀️ Chi so UV: ${weather.uvIndex}`;
            if (weather.uvIndex >= 8) weatherInfoHourly += ` 🔥 _Cao - PV tot!_`;
          } else if (h.period === 'afternoon') {
            weatherInfoHourly += `\n☀️ Chi so UV: ${weather.uvIndex}`;
            if (weather.rainChance > 60) weatherInfoHourly += `\n⚠️ _Co the co mua chieu nay!_`;
          } else {
            weatherInfoHourly += `\n🌅 Mat troi moc: ${weather.sunrise} | lan: ${weather.sunset}`;
          }
        }
        const msgHourly = `${h.emoji} *${h.label} - ${deviceId}*\n\n☀️ PV: *${rt.pvPower}W*\n🔋 Pin: *${rt.batterySoc}%* ${batteryStatus}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${haDevice.hasGridPower ? '🟢' : '🔴'}${weatherInfoHourly}${h.tip}\n\n⏰ ${getVietnamTime()}`;
        results.push({ type: `hourly_${h.hour}h`, sent: await sendTelegram(chatId, msgHourly) });
        await new Promise(r => setTimeout(r, 500));
      }
      
      return jsonResponse({ 
        success: true, 
        device: deviceId,
        chatId: chatId,
        location: locationName,
        weather: weather ? 'loaded' : 'unavailable',
        notifications_sent: results,
        timestamp: getVietnamTime()
      });
    }
    if (url.pathname === '/test-send') { const testChatId = 273383744; const haDevices = await fetchAllDevicesFromHA(env); const testDevice = haDevices.find(d => d.deviceId === 'H250422132') || haDevices[0]; if (testDevice) { const rt = testDevice.realtime; const sent = await sendTelegram(testChatId, `🧪 *TEST THONG BAO TU DONG*\n\n📱 Device: ${testDevice.deviceId}\n⚡ Grid: ${rt.gridPower}W ${testDevice.hasGridPower ? '🟢 Co dien' : '🔴 Mat dien'}\n🔋 Pin: ${rt.batterySoc}%\n☀️ PV: ${rt.pvPower}W\n🏠 Load: ${rt.loadPower}W\n\n✅ Cron Trigger dang hoat dong!\n⏰ ${getVietnamTime()}`); return jsonResponse({ success: sent, message: 'Test message sent', chatId: testChatId }); } return jsonResponse({ success: false, message: 'No device found' }); }
    if (url.pathname === '/kv-status') { const hasKV = !!env.BOT_KV; let count = 0, states = null; if (hasKV) { try { const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }); states = await env.BOT_KV.get(KV_KEYS.DEVICE_STATES, { type: 'json' }); count = data?.length || 0; } catch (e) {} } return jsonResponse({ kvBound: hasKV, usersCount: count, statesTracked: states ? Object.keys(states).length : 0, message: hasKV ? 'KV active' : 'KV not bound' }); }
    if (url.pathname === '/kv-backup') { if (!env.BOT_KV) return jsonResponse({ error: 'KV not bound' }, 400); return jsonResponse({ backup: await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }), timestamp: new Date().toISOString() }); }
    if (url.pathname === '/health') { const hasKV = !!env.BOT_KV; let count = 0; if (hasKV) { const data = await env.BOT_KV.get(KV_KEYS.DEVICES, { type: 'json' }); count = data?.length || 0; } return jsonResponse({ status: 'ok', version: '1.4.0', mode: 'Direct_HA', storage: hasKV ? 'KV_Persistent' : 'In-Memory', notifications: 'enabled', webAPI: 'enabled', users: count }); }
    return corsResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LightEarth Bot v1.3.0</title></head><body style="font-family:Arial;max-width:600px;margin:50px auto;padding:20px"><h1>☀️ LightEarth Bot v1.3.0</h1><p style="color:green">✅ KV Storage + Enhanced Weather Content!</p><h2>Commands:</h2><ul><li>/start, /help - Huong dan</li><li>/add, /remove, /list - Quan ly thiet bi</li><li>/status, /check - Trang thai</li><li>/settings - Cai dat thong bao</li><li>/location - Cai dat vung thoi tiet (tung thiet bi)</li></ul><h2>🔔 Thong bao tu dong:</h2><ul><li>🌅 Chao buoi sang + Du bao thoi tiet chi tiet (6-7h)</li><li>⚡ Mat dien luoi EVN + Goi y tinh trang</li><li>✅ Co dien lai (kem thoi gian mat dien)</li><li>🚭 Pin yeu (<20%) + Canh bao va goi y</li><li>🌇 Ket thuc ngay nang + Danh gia cho dem</li><li>⏰ Bao cao moi gio (6h-21h) + Thoi tiet hien tai</li></ul><h2>🌤️ Thoi tiet chi tiet:</h2><ul><li>Nhiet do hien tai va du bao</li><li>Do am, toc do gio</li><li>Chi so UV</li><li>Kha nang mua</li><li>Gio mat troi moc/lan</li></ul><h2>Debug:</h2><ul><li><a href="/kv-status">/kv-status</a></li><li><a href="/kv-backup">/kv-backup</a></li><li><a href="/trigger-notifications">/trigger-notifications</a></li><li><a href="/test-send">/test-send</a></li></ul></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(processNotifications(env)); }
};
