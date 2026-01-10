/**
 * LightEarth API Gateway v4.0
 * Solar Energy Monitoring System - 100% FREE (No Railway needed!)
 * 
 * Features:
 * - Real-time solar data (Direct HA access)
 * - Power history & analytics
 * - Temperature monitoring
 * - Device information
 * - Vietnam timezone (UTC+7)
 * - Full devices list with realtime data
 * 
 * Security:
 * - Rate limiting by Device ID
 * - Origin validation
 * - Input sanitization
 * - No API key needed (public read-only)
 * 
 * v4.0 Changes:
 * - NEW: /api/cloud/devices-full - Full realtime data for ALL devices (for Private Dashboard)
 * - Optimized for 100% Cloudflare deployment
 * - No Railway dependency
 */

const VN_OFFSET_HOURS = 7;
const REALTIME_CACHE_TTL = 5;

const WHITELIST_DEVICE_IDS = ['P250801055'];

const DEVICE_RATE_LIMIT = {
  maxRequests: 30,
  windowMs: 60 * 1000,
  blockDurationMs: 5 * 60 * 1000,
};

const deviceRateLimitMap = new Map();

function isDeviceRateLimited(deviceId) {
  if (WHITELIST_DEVICE_IDS.includes(deviceId.toUpperCase())) return false;
  const now = Date.now();
  const key = deviceId.toUpperCase();
  const record = deviceRateLimitMap.get(key);
  if (!record) {
    deviceRateLimitMap.set(key, { count: 1, windowStart: now, blocked: false });
    return false;
  }
  if (record.blocked && now < record.blockedUntil) return true;
  if (record.blocked && now >= record.blockedUntil) {
    record.blocked = false; record.count = 1; record.windowStart = now; return false;
  }
  if (now - record.windowStart > DEVICE_RATE_LIMIT.windowMs) {
    record.count = 1; record.windowStart = now; return false;
  }
  record.count++;
  if (record.count > DEVICE_RATE_LIMIT.maxRequests) {
    record.blocked = true;
    record.blockedUntil = now + DEVICE_RATE_LIMIT.blockDurationMs;
    return true;
  }
  return false;
}

const SECURITY_CONFIG = {
  allowedOrigins: [
    'https://lightearth1.up.railway.app',
    'https://lightearth2.up.railway.app',
    'https://lumentree.net',
    'https://www.lumentree.net',
    'https://solar.applike098.workers.dev',
    'https://lightearth.applike098.workers.dev',
    'https://full-device.applike098.workers.dev',
    'https://lumentreeinfo-api-production.up.railway.app',
    'https://lumentree-beta.pages.dev',
    'https://lumentree.pages.dev',
    'https://lumentree-lighearth.pages.dev',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:8080',
  ],
  rateLimit: { maxRequests: 100, windowMs: 60 * 1000, blockDurationMs: 5 * 60 * 1000 },
};

const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record) { rateLimitMap.set(ip, { count: 1, windowStart: now, blocked: false }); return false; }
  if (record.blocked && now < record.blockedUntil) return true;
  if (record.blocked && now >= record.blockedUntil) { record.blocked = false; record.count = 1; record.windowStart = now; return false; }
  if (now - record.windowStart > SECURITY_CONFIG.rateLimit.windowMs) { record.count = 1; record.windowStart = now; return false; }
  record.count++;
  if (record.count > SECURITY_CONFIG.rateLimit.maxRequests) { record.blocked = true; record.blockedUntil = now + SECURITY_CONFIG.rateLimit.blockDurationMs; return true; }
  return false;
}

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  return SECURITY_CONFIG.allowedOrigins.some(allowed => origin === allowed || origin.endsWith('.workers.dev') || origin.endsWith('.railway.app') || origin.endsWith('.pages.dev'));
}

function createSecurityHeaders(origin) {
  const allowedOrigin = isOriginAllowed(origin) ? (origin || '*') : SECURITY_CONFIG.allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function isValidDeviceId(deviceId) { return /^[A-Za-z0-9_-]+$/.test(deviceId); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const clientIP = getClientIP(request);
    const headers = createSecurityHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (isRateLimited(clientIP)) return new Response(JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED', retryAfter: 300 }), { status: 429, headers });

    const PI_URL = env.PI_URL || env.HA_URL || '';
    const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN || '';

    if (path === '/' || path === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '4.0', features: ['realtime', 'devices-full', 'power-history', 'temperature'] }), { headers });
    }

    if (path === '/api/cloud/devices-full' || path === '/api/cloud/devices') {
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable - HA not configured' }), { status: 503, headers });
      try {
        const cache = caches.default;
        const cacheKey = new Request(url.toString());
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) { const newHeaders = new Headers(cachedResponse.headers); newHeaders.set('X-Cache', 'HIT'); return new Response(cachedResponse.body, { status: cachedResponse.status, headers: newHeaders }); }
        const data = await fetchAllDevicesWithRealtime(PI_URL, PI_TOKEN);
        const response = new Response(JSON.stringify(data), { headers: { ...headers, 'Cache-Control': `public, max-age=${REALTIME_CACHE_TTL}`, 'X-Cache': 'MISS' } });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) { return new Response(JSON.stringify({ success: false, error: 'Failed to fetch devices', message: error.message }), { status: 500, headers }); }
    }

    if (path.match(/^\/api\/realtime\/device\/([^\/]+)$/)) {
      const match = path.match(/^\/api\/realtime\/device\/([^\/]+)$/);
      const deviceId = match[1];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
      if (isDeviceRateLimited(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Too many requests for this device', code: 'DEVICE_RATE_LIMITED', retryAfter: 300 }), { status: 429, headers });
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
      try {
        const cache = caches.default;
        const cacheKey = new Request(url.toString());
        let cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) { const newHeaders = new Headers(cachedResponse.headers); newHeaders.set('X-Cache', 'HIT'); return new Response(cachedResponse.body, { status: cachedResponse.status, headers: newHeaders }); }
        const data = await fetchRealtimeDeviceData(PI_URL, PI_TOKEN, deviceId);
        const response = new Response(JSON.stringify(data), { headers: { ...headers, 'Cache-Control': `public, max-age=3`, 'X-Cache': 'MISS' } });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) { return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers }); }
    }

    if (path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
      const match = path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1], queryDate = match[2];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
      try { const data = await fetchCloudPowerHistory(PI_URL, PI_TOKEN, deviceId, queryDate); return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers }); }
      catch (error) { return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers }); }
    }

    if (path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
      const match = path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1], queryDate = match[2];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
      try { const data = await fetchCloudSOCHistory(PI_URL, PI_TOKEN, deviceId, queryDate); return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers }); }
      catch (error) { return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers }); }
    }

    if (path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
      const match = path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1], queryDate = match[2];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
      try { const data = await fetchCloudTemperatureHistory(PI_URL, PI_TOKEN, deviceId, queryDate); return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers }); }
      catch (error) { return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers }); }
    }

    if (path.match(/^\/api\/cloud\/monthly\/([^\/]+)$/)) {
      if (!PI_URL || !PI_TOKEN) return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
      const match = path.match(/^\/api\/cloud\/monthly\/([^\/]+)$/);
      const deviceId = match[1];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
      try { const data = await fetchCloudMonthlyEnergy(PI_URL, PI_TOKEN, deviceId); return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers }); }
      catch (error) { return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers }); }
    }

    const apiHeaders = { 'Accept-Language': 'vi-VN,vi;q=0.8', 'User-Agent': 'okhttp-okgo/jeasonlzy', 'Authorization': '4A0867E6A8D90DC9E5735DBDEDD99A3A', 'source': '2', 'versionCode': '20241025', 'platform': '2', 'wifiStatus': '1' };

    if (path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      const match = path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
      try { const res = await fetch(`https://lesvr.suntcn.com/lesvr/getBatDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders }); return new Response(JSON.stringify(await res.json()), { headers }); }
      catch (error) { return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers }); }
    }

    if (path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      const match = path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
      try { const res = await fetch(`https://lesvr.suntcn.com/lesvr/getPVDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders }); return new Response(JSON.stringify(await res.json()), { headers }); }
      catch (error) { return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers }); }
    }

    if (path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
      const match = path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      const deviceId = match[1];
      if (!isValidDeviceId(deviceId)) return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
      try { const res = await fetch(`https://lesvr.suntcn.com/lesvr/getOtherDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders }); return new Response(JSON.stringify(await res.json()), { headers }); }
      catch (error) { return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers }); }
    }

    return new Response(JSON.stringify({ error: 'Not found', path }), { status: 404, headers });
  }
};

async function fetchAllDevicesWithRealtime(piUrl, piToken) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`HA API error: ${response.status}`);
  const states = await response.json();
  const deviceIds = new Set();
  const deviceRegex = /^sensor\.device_([a-z0-9]+)_/i;
  states.forEach(state => { const match = state.entity_id.match(deviceRegex); if (match) deviceIds.add(match[1].toUpperCase()); });
  const devices = [];
  let totalPvPower = 0, totalLoadPower = 0, totalGridPower = 0, totalPvDay = 0, totalLoadDay = 0, totalGridDay = 0, onlineCount = 0;
  for (const deviceId of deviceIds) {
    const devicePrefix = `sensor.device_${deviceId.toLowerCase()}_`;
    const binaryPrefix = `binary_sensor.device_${deviceId.toLowerCase()}_`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(devicePrefix));
    const binaryStates = states.filter(s => s.entity_id.startsWith(binaryPrefix));
    const getValue = (suffix) => { const entity = deviceStates.find(s => s.entity_id === `${devicePrefix}${suffix}`); return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null; };
    const parseNum = (val) => val !== null ? parseFloat(val) : 0;
    const onlineEntity = binaryStates.find(s => s.entity_id.includes('_online_status'));
    const isOnline = onlineEntity?.state === 'on' || (getValue('pv_power') !== null);
    let model = null;
    const tempEntity = deviceStates.find(s => s.entity_id.includes('_device_temperature'));
    if (tempEntity?.attributes?.friendly_name) { const modelMatch = tempEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i); if (modelMatch) model = modelMatch[1].toUpperCase().replace('KW', 'kW'); }
    const pvPower = parseNum(getValue('pv_power')), batteryPower = parseNum(getValue('battery_power')), loadPower = parseNum(getValue('total_load_power')) || parseNum(getValue('load_power')), gridPower = parseNum(getValue('grid_power')), batterySoc = parseNum(getValue('battery_soc')), temperature = parseNum(getValue('device_temperature'));
    const pvDay = parseNum(getValue('pv_today')), loadDay = parseNum(getValue('total_load_today')) || parseNum(getValue('load_today')), gridDay = parseNum(getValue('grid_in_today')), chargeDay = parseNum(getValue('charge_today')), dischargeDay = parseNum(getValue('discharge_today')), exportDay = parseNum(getValue('grid_out_today')) || parseNum(getValue('essential_today'));
    if (isOnline) { onlineCount++; totalPvPower += pvPower; totalLoadPower += loadPower; totalGridPower += gridPower; totalPvDay += pvDay; totalLoadDay += loadDay; totalGridDay += gridDay; }
    devices.push({ deviceId, isOnline, model, sensorCount: deviceStates.length, realtime: { batterySoc: Math.round(batterySoc), pvPower: Math.round(pvPower), batteryPower: Math.round(batteryPower), loadPower: Math.round(loadPower), gridPower: Math.round(gridPower), temperature: Math.round(temperature * 10) / 10 }, dailyEnergy: { pvDay: Math.round(pvDay * 100) / 100, loadDay: Math.round(loadDay * 100) / 100, gridDay: Math.round(gridDay * 100) / 100, chargeDay: Math.round(chargeDay * 100) / 100, dischargeDay: Math.round(dischargeDay * 100) / 100, exportDay: Math.round(exportDay * 100) / 100 } });
  }
  devices.sort((a, b) => { if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1; return a.deviceId.localeCompare(b.deviceId); });
  return { success: true, source: 'CloudflareWorker_HA_v4', devices, summary: { total: devices.length, online: onlineCount, offline: devices.length - onlineCount, totalPvPower: Math.round(totalPvPower), totalLoadPower: Math.round(totalLoadPower), totalGridPower: Math.round(totalGridPower), totalPvDay: Math.round(totalPvDay * 100) / 100, totalLoadDay: Math.round(totalLoadDay * 100) / 100, totalGridDay: Math.round(totalGridDay * 100) / 100 }, timestamp: new Date().toISOString() };
}

async function fetchRealtimeDeviceData(piUrl, piToken, deviceId) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`HA API error: ${response.status}`);
  const states = await response.json();
  const deviceIdLower = deviceId.toLowerCase();
  const prefix = `sensor.device_${deviceIdLower}_`;
  const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));
  if (deviceStates.length === 0) return { success: false, message: `Device ${deviceId} not found`, deviceId };
  const getValue = (suffix) => { const entity = deviceStates.find(s => s.entity_id === `${prefix}${suffix}`); return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null; };
  const parseNum = (val) => val !== null ? parseFloat(val) : null;
  const parseInt = (val) => val !== null ? Math.round(parseFloat(val)) : null;
  let model = null;
  const pvPowerEntity = deviceStates.find(s => s.entity_id.includes('_pv_power'));
  if (pvPowerEntity?.attributes?.friendly_name) { const modelMatch = pvPowerEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i); if (modelMatch) model = modelMatch[1].toUpperCase().replace('KW', 'kW'); }
  return { success: true, source: "CloudflareWorker_HA_v4", deviceData: { deviceId: deviceId.toUpperCase(), model, timestamp: new Date().toISOString(), pv: { pv1Power: parseInt(getValue("pv1_power")), pv1Voltage: parseNum(getValue("pv1_voltage")), pv2Power: parseInt(getValue("pv2_power")), pv2Voltage: parseNum(getValue("pv2_voltage")), totalPower: parseInt(getValue("pv_power")) }, battery: { soc: parseInt(getValue("battery_soc")), power: parseInt(getValue("battery_power")), voltage: parseNum(getValue("battery_voltage")), current: parseNum(getValue("battery_current")), status: getValue("battery_status") }, grid: { power: parseInt(getValue("grid_power")), status: getValue("grid_status"), inputVoltage: parseNum(getValue("grid_voltage")), inputFrequency: parseNum(getValue("ac_input_frequency")) }, load: { homePower: parseInt(getValue("load_power")) || parseInt(getValue("total_load_power")), essentialPower: parseInt(getValue("ac_output_power")) }, temperature: parseNum(getValue("device_temperature")) } };
}

async function fetchCloudPowerHistory(piUrl, piToken, deviceId, queryDate) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const sensors = { pv: `sensor.device_${deviceId.toLowerCase()}_pv_power`, battery: `sensor.device_${deviceId.toLowerCase()}_battery_power`, grid: `sensor.device_${deviceId.toLowerCase()}_grid_power`, load: `sensor.device_${deviceId.toLowerCase()}_load_power` };
  const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`), vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
  const entityIds = Object.values(sensors).join(',');
  const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${entityIds}&minimal_response&significant_changes_only`;
  const response = await fetch(historyUrl, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const historyData = await response.json();
  const sensorTimelines = {}, sensorKeys = Object.keys(sensors);
  for (const sensorHistory of historyData) { if (!sensorHistory || sensorHistory.length === 0) continue; const entityId = sensorHistory[0].entity_id; const key = sensorKeys.find(k => sensors[k] === entityId); if (!key) continue; sensorTimelines[key] = sensorHistory.map(entry => ({ time: new Date(entry.last_changed || entry.last_updated).getTime(), value: parseFloat(entry.state) })).filter(e => !isNaN(e.value)).sort((a, b) => a.time - b.time); }
  const timeline = [], interval = 5 * 60 * 1000, dayStartMs = vnDayStart.getTime(), dayEndMs = vnDayEnd.getTime();
  const indices = { pv: 0, battery: 0, grid: 0, load: 0 }, lastValues = { pv: null, battery: null, grid: null, load: null }, hasSeenData = { pv: false, battery: false, grid: false, load: false };
  for (let time = dayStartMs; time <= dayEndMs; time += interval) { for (const key of sensorKeys) { const sensorData = sensorTimelines[key] || []; while (indices[key] < sensorData.length && sensorData[indices[key]].time <= time) { lastValues[key] = sensorData[indices[key]].value; hasSeenData[key] = true; indices[key]++; } } const vnTime = new Date(time), hours = vnTime.getUTCHours() + 7, adjustedHours = hours >= 24 ? hours - 24 : hours, minutes = vnTime.getUTCMinutes(); const localTimeStr = `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`; timeline.push({ time: localTimeStr, pv: hasSeenData.pv ? (lastValues.pv || 0) : 0, battery: hasSeenData.battery ? (lastValues.battery || 0) : 0, grid: hasSeenData.grid ? (lastValues.grid || 0) : 0, load: hasSeenData.load ? (lastValues.load || 0) : 0 }); }
  return { timeline, stats: { maxPv: Math.max(...timeline.map(t => t.pv)), maxLoad: Math.max(...timeline.map(t => t.load)), count: timeline.length } };
}

async function fetchCloudSOCHistory(piUrl, piToken, deviceId, queryDate) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const socEntity = `sensor.device_${deviceId.toLowerCase()}_battery_soc`;
  const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`), vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
  const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${socEntity}&minimal_response`;
  const response = await fetch(historyUrl, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const historyData = await response.json();
  if (!historyData || historyData.length === 0 || historyData[0].length === 0) return { timeline: [], count: 0 };
  const timeline = historyData[0].map(entry => { const utcTime = new Date(entry.last_changed || entry.last_updated), vnHours = utcTime.getUTCHours() + 7, adjustedHours = vnHours >= 24 ? vnHours - 24 : vnHours, minutes = utcTime.getUTCMinutes(); return { t: `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, soc: parseFloat(entry.state) || 0 }; }).filter(entry => !isNaN(entry.soc));
  return { timeline, count: timeline.length };
}

async function fetchCloudTemperatureHistory(piUrl, piToken, deviceId, queryDate) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const tempEntity = `sensor.device_${deviceId.toLowerCase()}_device_temperature`;
  const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`), vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
  const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${tempEntity}&minimal_response`;
  const response = await fetch(historyUrl, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const historyData = await response.json();
  if (!historyData || historyData.length === 0 || historyData[0].length === 0) return { min: null, max: null, current: null, count: 0 };
  const temps = historyData[0].map(entry => parseFloat(entry.state)).filter(temp => !isNaN(temp) && temp > 0 && temp < 100);
  if (temps.length === 0) return { min: null, max: null, current: null, count: 0 };
  const min = Math.min(...temps), max = Math.max(...temps), current = temps[temps.length - 1];
  let minTime = '--:--', maxTime = '--:--';
  historyData[0].forEach(entry => { const temp = parseFloat(entry.state); if (temp === min || temp === max) { const utcTime = new Date(entry.last_changed || entry.last_updated), vnHours = utcTime.getUTCHours() + 7, adjustedHours = vnHours >= 24 ? vnHours - 24 : vnHours, minutes = utcTime.getUTCMinutes(); const timeStr = `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`; if (temp === min) minTime = timeStr; if (temp === max) maxTime = timeStr; } });
  return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, current: Math.round(current * 10) / 10, minTime, maxTime, count: temps.length };
}

async function fetchCloudMonthlyEnergy(piUrl, piToken, deviceId) {
  const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  const states = await response.json();
  const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
  const deviceStates = states.filter(state => state.entity_id.startsWith(devicePrefix));
  const getValue = (suffix) => { const entity = deviceStates.find(s => s.entity_id.endsWith(suffix)); return entity ? parseFloat(entity.state) || 0 : 0; };
  const now = new Date(), currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { month: currentMonth, today: { pv: getValue('_pv_today'), load: getValue('_load_today') || getValue('_total_load_today'), grid: getValue('_grid_in_today'), charge: getValue('_charge_today'), discharge: getValue('_discharge_today'), essential: getValue('_essential_today') }, monthly: { pv: getValue('_pv_month'), load: getValue('_load_month'), grid: getValue('_grid_in_month'), charge: getValue('_charge_month'), discharge: getValue('_discharge_month'), essential: getValue('_essential_month') }, year: { pv: getValue('_pv_year'), load: getValue('_load_year'), grid: getValue('_grid_in_year'), charge: getValue('_charge_year'), discharge: getValue('_discharge_year'), essential: getValue('_essential_year') }, total: { pv: getValue('_pv_total'), load: getValue('_load_total'), grid: getValue('_grid_in_total'), charge: getValue('_charge_total'), discharge: getValue('_discharge_total'), essential: getValue('_essential_total') }, timestamp: new Date().toISOString() };
}
