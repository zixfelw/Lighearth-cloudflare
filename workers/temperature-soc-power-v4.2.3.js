/**
 * Temperature-SOC-Power Worker v4.1
 * 
 * UPDATE v4.1:
 * - FIXED: Dashboard now fetches multi-year data (2024+2025+2026)
 * - FIXED: MIN/MAX Temperature in header (was showing undefined)
 * - NEW: chartData included for monthly chart display
 * - NEW: /api/solar/dashboard returns all years combined
 * 
 * UPDATE v4.0:
 * - NEW: MAX December PV Selection - finds record with highest T12 PV value
 * - Searches entire 31/12 to find best data before year rollover
 * - Prevents corrupt data from sensor reset (e.g., 756.6 kWh vs 607.4 kWh)
 * - Quality score based on December PV value (higher = better)
 * 
 * UPDATE v3.1:
 * - FIXED: getYearlyStatistics now fetches from HA history for past years
 * - Uses history API to find pv_year sensor data at specific year
 * - Added HTML output with Copy button for easy data sharing
 * - Better error handling and fallback
 * 
 * MAJOR UPDATE v3.0:
 * - Uses sensor attributes (series_5min_w, series_hour_kwh) for FULL 24h data
 * - NOT affected by HA restart - data is stored in sensor attributes
 * - Power History: 288 data points (every 5 minutes)
 * - SOC History: Uses History API with fallback
 * - Temperature History: Uses History API with fallback
 * - Charge/Discharge: 24 hourly data points
 * 
 * Data Sources:
 * - sensor.device_*_pv_today -> attributes.series_5min_w (288 points)
 * - sensor.device_*_load_today -> attributes.series_5min_w (288 points)
 * - sensor.device_*_grid_in_today -> attributes.series_5min_w (288 points)
 * - sensor.device_*_charge_today -> attributes.series_hour_kwh (24 points)
 * - sensor.device_*_discharge_today -> attributes.series_hour_kwh (24 points)
 * 
 * Environment Variables (set in Cloudflare Dashboard -> Settings -> Variables):
 * - HA_URL: Home Assistant tunnel URL
 * - HA_TOKEN: Home Assistant Long-Lived Access Token
 */

const VN_TIMEZONE_OFFSET = 7;
const VERSION = '4.2.3';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  };
}

function htmlHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache'
  };
}

function jsonResponse(data, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin)
  });
}

function htmlResponse(html, origin, status = 200) {
  return new Response(html, {
    status,
    headers: htmlHeaders(origin)
  });
}

async function fetchHA(endpoint, env) {
  const haUrl = env.HA_URL || env.PI_URL;
  const haToken = env.HA_TOKEN || env.PI_TOKEN;

  if (!haUrl || !haToken) {
    throw new Error('HA_URL or HA_TOKEN not configured');
  }

  const response = await fetch(`${haUrl}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${haToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HA API error: ${response.status}`);
  }

  return response.json();
}

function toVietnamTime(utcTimestamp) {
  const date = new Date(utcTimestamp);
  date.setHours(date.getUTCHours() + VN_TIMEZONE_OFFSET);
  return date;
}

function getVietnamDateString(utcTimestamp) {
  const vnDate = toVietnamTime(utcTimestamp);
  const year = vnDate.getUTCFullYear();
  const month = (vnDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = vnDate.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getVietnamToday() {
  const now = new Date();
  now.setHours(now.getUTCHours() + VN_TIMEZONE_OFFSET);
  return `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}-${now.getUTCDate().toString().padStart(2, '0')}`;
}

function getVietnamCurrentHour() {
  const now = new Date();
  now.setHours(now.getUTCHours() + VN_TIMEZONE_OFFSET);
  return now.getUTCHours();
}

function getCurrentVietnamYear() {
  const now = new Date();
  now.setHours(now.getUTCHours() + VN_TIMEZONE_OFFSET);
  return now.getUTCFullYear();
}

function indexToTimeStr(index) {
  const totalMinutes = index * 5;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

async function getPowerHistory(deviceId, date, env) {
  const deviceLower = deviceId.toLowerCase();
  const today = getVietnamToday();

  if (date !== today) {
    return getPowerHistoryFromHistoryAPI(deviceId, date, env);
  }

  try {
    const [pvSensor, loadSensor, gridSensor, totalLoadSensor] = await Promise.all([
      fetchHA(`/api/states/sensor.device_${deviceLower}_pv_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_load_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_grid_in_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_total_load_today`, env)
    ]);

    const [chargeSensor, dischargeSensor] = await Promise.all([
      fetchHA(`/api/states/sensor.device_${deviceLower}_charge_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_discharge_today`, env)
    ]);

    const pvSeries = pvSensor?.attributes?.series_5min_w || [];
    const loadSeries = loadSensor?.attributes?.series_5min_w || [];
    const gridSeries = gridSensor?.attributes?.series_5min_w || [];
    const totalLoadSeries = totalLoadSensor?.attributes?.series_5min_w || [];
    const chargeHourly = chargeSensor?.attributes?.series_hour_kwh || [];
    const dischargeHourly = dischargeSensor?.attributes?.series_hour_kwh || [];

    if (pvSeries.length === 0 && loadSeries.length === 0) {
      return { success: true, timeline: [], count: 0, message: 'No power data', version: VERSION, source: 'sensor_attributes' };
    }

    const currentHour = getVietnamCurrentHour();
    const currentIndex = Math.min((currentHour + 1) * 12, 288);
    const timeline = [];

    for (let i = 0; i < currentIndex; i++) {
      const timeStr = indexToTimeStr(i);
      const hour = Math.floor(i / 12);
      const pv = pvSeries[i] || 0;
      const load = loadSeries[i] || 0;
      const grid = gridSeries[i] || 0;
      const totalLoad = totalLoadSeries[i] || 0;
      const chargeKwh = chargeHourly[hour] || 0;
      const dischargeKwh = dischargeHourly[hour] || 0;
      const batPowerEstimate = Math.round((chargeKwh - dischargeKwh) * 1000);

      if (pv > 0 || load > 0 || grid > 0 || totalLoad > 0 || Math.abs(batPowerEstimate) > 10) {
        timeline.push({
          t: timeStr,
          pv: Math.round(pv),
          load: Math.round(load),
          grid: Math.round(grid),
          bat: batPowerEstimate,
          backup: 0,
          totalLoad: Math.round(totalLoad)
        });
      }
    }

    return { success: true, deviceId, date, timeline, count: timeline.length, version: VERSION, source: 'sensor_attributes', dataPoints: { pv: pvSeries.length, load: loadSeries.length, grid: gridSeries.length } };
  } catch (error) {
    return getPowerHistoryFromHistoryAPI(deviceId, date, env);
  }
}

async function getPowerHistoryFromHistoryAPI(deviceId, date, env) {
  const deviceLower = deviceId.toLowerCase();
  const entities = [
    `sensor.device_${deviceLower}_battery_power`,
    `sensor.device_${deviceLower}_pv_power`,
    `sensor.device_${deviceLower}_load_power`,
    `sensor.device_${deviceLower}_grid_power`,
    `sensor.device_${deviceLower}_ac_output_power`
  ];

  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 1);
  const startTime = `${startDate.toISOString().split('T')[0]}T17:00:00`;
  const endTime = `${date}T16:59:59`;

  const data = await fetchHA(`/api/history/period/${startTime}?filter_entity_id=${entities.join(',')}&end_time=${endTime}`, env);

  if (!data || data.length === 0) {
    return { success: true, timeline: [], count: 0, message: 'No power data', version: VERSION, source: 'history_api' };
  }

  const timeSlots = {};
  const entityNames = ['bat', 'pv', 'load', 'grid', 'backup'];

  data.forEach((entityData, index) => {
    if (entityData && entityData.length > 0) {
      entityData.forEach(item => {
        const vnDateStr = getVietnamDateString(item.last_changed);
        if (vnDateStr !== date) return;
        const vnTime = toVietnamTime(item.last_changed);
        const hours = vnTime.getUTCHours();
        const minutes = Math.floor(vnTime.getUTCMinutes() / 5) * 5;
        const timeKey = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        if (!timeSlots[timeKey]) {
          timeSlots[timeKey] = { t: timeKey, pv: 0, bat: 0, load: 0, grid: 0, backup: 0 };
        }
        const val = parseFloat(item.state);
        if (!isNaN(val)) {
          timeSlots[timeKey][entityNames[index]] = Math.round(val);
        }
      });
    }
  });

  const timeline = Object.values(timeSlots).sort((a, b) => a.t.localeCompare(b.t));
  return { success: true, deviceId, date, timeline, count: timeline.length, version: VERSION, source: 'history_api' };
}

async function getSOCHistory(deviceId, date, env) {
  const deviceLower = deviceId.toLowerCase();
  const entityId = `sensor.device_${deviceLower}_battery_soc`;
  const today = getVietnamToday();

  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 1);
  const startTime = `${startDate.toISOString().split('T')[0]}T17:00:00`;

  // Dynamic end time: current time for today, end of day for past dates
  let endTime;
  if (date === today) {
    // For today: fetch up to current time
    const now = new Date();
    const vnNow = new Date(now.getTime() + VN_TIMEZONE_OFFSET * 60 * 60 * 1000);
    const hours = vnNow.getUTCHours().toString().padStart(2, '0');
    const mins = vnNow.getUTCMinutes().toString().padStart(2, '0');
    endTime = `${date}T${hours}:${mins}:59`;
  } else {
    // For past dates: fetch entire day
    endTime = `${date}T23:59:59`;
  }

  const data = await fetchHA(`/api/history/period/${startTime}?filter_entity_id=${entityId}&end_time=${endTime}`, env);

  if (!data || data.length === 0 || !data[0] || data[0].length === 0) {
    return { success: true, deviceId, date, timeline: [], count: 0, message: 'No SOC data', version: VERSION };
  }

  const timeSlots = {};
  let minSOC = Infinity, maxSOC = -Infinity;
  let minTime = null, maxTime = null;
  let currentSOC = null;

  // Debug counters
  let debugCounts = {
    total: data[0]?.length || 0,
    dateMismatch: 0,
    invalidState: 0,
    outOfRange: 0,
    passed: 0,
    sampleRejected: []
  };

  data[0].forEach(item => {
    const vnDateStr = getVietnamDateString(item.last_changed);
    if (vnDateStr !== date) {
      debugCounts.dateMismatch++;
      if (debugCounts.sampleRejected.length < 3) {
        debugCounts.sampleRejected.push({ reason: 'date', vnDate: vnDateStr, expectedDate: date, raw: item.last_changed });
      }
      return;
    }

    // Skip invalid states
    const state = item.state;
    if (state === 'unavailable' || state === 'unknown' || state === null || state === '') {
      debugCounts.invalidState++;
      return;
    }

    const soc = parseFloat(state);
    // Filter: must be valid number AND in reasonable range (0-100%)
    if (isNaN(soc) || soc < 0 || soc > 100) {
      debugCounts.outOfRange++;
      return;
    }

    debugCounts.passed++;

    const vnTime = toVietnamTime(item.last_changed);
    const hours = vnTime.getUTCHours();
    const minutes = Math.floor(vnTime.getUTCMinutes() / 5) * 5;
    const timeKey = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    const socRounded = Math.round(soc);

    timeSlots[timeKey] = { t: timeKey, soc: socRounded };
    currentSOC = socRounded;

    // Track min/max - skip values <= 1% as likely sensor glitches
    if (soc > 1) {
      if (soc < minSOC) {
        minSOC = soc;
        minTime = timeKey;
      }
      if (soc > maxSOC) {
        maxSOC = soc;
        maxTime = timeKey;
      }
    }
  });

  const timeline = Object.values(timeSlots).sort((a, b) => a.t.localeCompare(b.t));

  // Return with calculated min/max from Worker
  return {
    success: true,
    deviceId,
    date,
    timeline,
    count: timeline.length,
    current: currentSOC,
    min: minSOC !== Infinity ? Math.round(minSOC) : null,
    max: maxSOC !== -Infinity ? Math.round(maxSOC) : null,
    minTime,
    maxTime,
    version: VERSION,
    source: 'history_api',
    debug: debugCounts
  };
}

async function getTemperatureHistory(deviceId, date, env) {
  const deviceLower = deviceId.toLowerCase();
  const entityId = `sensor.device_${deviceLower}_device_temperature`;

  // Vietnam timezone: UTC+7
  // To get full day data for a Vietnam date, we need:
  // Start: (date-1) 17:00 UTC = (date) 00:00 VN
  // End: (date) 16:59:59 UTC = (date) 23:59:59 VN
  // But if current date, extend to current time
  const today = getVietnamToday();
  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 1);
  const startTime = `${startDate.toISOString().split('T')[0]}T17:00:00Z`;

  // If querying today, use current time; otherwise use end of day (16:59:59 UTC = 23:59:59 VN)
  let endTime;
  if (date === today) {
    // Use current time for today's data
    const now = new Date();
    endTime = now.toISOString();
  } else {
    // For past dates, get full day
    endTime = `${date}T16:59:59Z`;
  }

  const data = await fetchHA(`/api/history/period/${startTime}?filter_entity_id=${entityId}&end_time=${endTime}`, env);

  if (!data || data.length === 0 || !data[0] || data[0].length === 0) {
    return { success: false, deviceId, date, timeline: [], count: 0, min: null, max: null, message: 'No temperature data', version: VERSION };
  }

  const timeSlots = {};
  let minTemp = Infinity, maxTemp = -Infinity;
  let minTime = null, maxTime = null;
  let currentTemp = null;

  data[0].forEach(item => {
    const vnDateStr = getVietnamDateString(item.last_changed);
    if (vnDateStr !== date) return;
    const vnTime = toVietnamTime(item.last_changed);
    const hours = vnTime.getUTCHours();
    const minutes = Math.floor(vnTime.getUTCMinutes() / 30) * 30;
    const timeKey = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    const temp = parseFloat(item.state);

    if (!isNaN(temp)) {
      timeSlots[timeKey] = { t: timeKey, temp: Math.round(temp * 10) / 10 };
      currentTemp = Math.round(temp * 10) / 10; // Last reading = current

      // Track min/max
      if (temp < minTemp) {
        minTemp = temp;
        minTime = timeKey;
      }
      if (temp > maxTemp) {
        maxTemp = temp;
        maxTime = timeKey;
      }
    }
  });

  const timeline = Object.values(timeSlots).sort((a, b) => a.t.localeCompare(b.t));

  // Return with min/max for header display
  return {
    success: timeline.length > 0,
    deviceId,
    date,
    timeline,
    count: timeline.length,
    // Min/Max for header badge
    min: minTemp !== Infinity ? Math.round(minTemp * 10) / 10 : null,
    max: maxTemp !== -Infinity ? Math.round(maxTemp * 10) / 10 : null,
    minTime: minTime,
    maxTime: maxTime,
    current: currentTemp,
    version: VERSION
  };
}

async function getPowerPeak(deviceId, date, env) {
  const deviceLower = deviceId.toLowerCase();
  const today = getVietnamToday();

  try {
    const [pvSensor, loadSensor, gridSensor] = await Promise.all([
      fetchHA(`/api/states/sensor.device_${deviceLower}_pv_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_load_today`, env),
      fetchHA(`/api/states/sensor.device_${deviceLower}_grid_in_today`, env)
    ]);

    const pvSeries = pvSensor?.attributes?.series_5min_w || [];
    const loadSeries = loadSensor?.attributes?.series_5min_w || [];
    const gridSeries = gridSensor?.attributes?.series_5min_w || [];

    let pvPeak = { value: 0, time: null };
    let loadPeak = { value: 0, time: null };
    let gridPeak = { value: 0, time: null };

    for (let i = 0; i < 288; i++) {
      const timeStr = indexToTimeStr(i);
      if (pvSeries[i] > pvPeak.value) { pvPeak = { value: Math.round(pvSeries[i]), time: timeStr }; }
      if (loadSeries[i] > loadPeak.value) { loadPeak = { value: Math.round(loadSeries[i]), time: timeStr }; }
      if (gridSeries[i] > gridPeak.value) { gridPeak = { value: Math.round(gridSeries[i]), time: timeStr }; }
    }

    return { success: true, deviceId, date, peaks: { pv: pvPeak, load: loadPeak, grid: gridPeak }, version: VERSION, source: 'sensor_attributes' };
  } catch (error) {
    return { success: false, error: error.message, version: VERSION };
  }
}

async function getDailyEnergy(deviceId, env) {
  const deviceLower = deviceId.toLowerCase();
  const today = getVietnamToday();

  const sensors = ['pv_today', 'load_today', 'grid_in_today', 'total_load_today', 'charge_today', 'discharge_today', 'essential_today'];
  const results = {};

  for (const sensor of sensors) {
    try {
      const data = await fetchHA(`/api/states/sensor.device_${deviceLower}_${sensor}`, env);
      const key = sensor.replace('_today', '');
      results[key] = parseFloat(data?.state) || 0;
    } catch (e) {
      results[sensor.replace('_today', '')] = 0;
    }
  }

  const summary = {
    pv: Math.round(results.pv * 10) / 10,
    load: Math.round(results.load * 10) / 10,
    totalLoad: Math.round(results.total_load * 10) / 10,
    grid: Math.round(results.grid_in * 10) / 10,
    charge: Math.round(results.charge * 10) / 10,
    discharge: Math.round(results.discharge * 10) / 10,
    essential: Math.round(results.essential * 10) / 10,
    selfConsumption: Math.round((results.pv - results.grid_in) * 10) / 10
  };

  return { success: true, deviceId, date: today, summary, raw: results, version: VERSION };
}

function calculateTieredPrice(kWh, vatRate = 0.08) {
  if (kWh <= 0) return 0;
  let totalCost = 0;
  let remaining = kWh;
  const tiers = [
    { limit: 50, price: 1984 },
    { limit: 50, price: 2050 },
    { limit: 100, price: 2380 },
    { limit: 100, price: 2998 },
    { limit: 100, price: 3350 },
    { limit: Infinity, price: 3460 }
  ];
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, tier.limit);
    totalCost += amount * tier.price;
    remaining -= amount;
  }
  return totalCost * (1 + vatRate);
}

async function getYearlyEnergyData(deviceId, env) {
  const deviceLower = deviceId.toLowerCase();
  try {
    const pvYearSensor = await fetchHA(`/api/states/sensor.device_${deviceLower}_pv_year`, env);
    if (!pvYearSensor || !pvYearSensor.attributes) { return { year: 0, months: [] }; }
    const attrs = pvYearSensor.attributes;
    const year = attrs.year || new Date().getFullYear();
    const monthlyTotalLoad = attrs.monthly_total_load || [];
    const monthlyGrid = attrs.monthly_grid || [];
    const monthlyEssential = attrs.monthly_essential || [];
    const monthlyData = [];
    for (let i = 0; i < 12; i++) {
      const totalLoad = monthlyTotalLoad[i] || 0;
      const grid = monthlyGrid[i] || 0;
      const essential = monthlyEssential[i] || 0;
      if (totalLoad > 0 || grid > 0) {
        const monthNumber = i + 1;
        monthlyData.push({ month: `${year}-${monthNumber.toString().padStart(2, '0')}`, monthNumber, totalLoad: Math.round(totalLoad * 10) / 10, grid: Math.round(grid * 10) / 10, essential: Math.round(essential * 10) / 10 });
      }
    }
    return { year, months: monthlyData };
  } catch (e) { return { year: 0, months: [] }; }
}

// v3.1: Enhanced getYearlyStatistics - fetches from history for past years
async function getYearlyStatistics(deviceId, year, env) {
  const deviceLower = deviceId.toLowerCase();
  const deviceUpper = deviceId.toUpperCase();
  const currentYear = getCurrentVietnamYear();

  try {
    // For current year, use current sensor state
    if (year === currentYear) {
      return await getYearlyStatisticsFromCurrentSensor(deviceId, env);
    }

    // For past years, search in history
    return await getYearlyStatisticsFromHistory(deviceId, year, env);

  } catch (e) {
    return { success: false, deviceId: deviceUpper, year, error: e.message, version: VERSION };
  }
}

// Get yearly stats from current sensor (for current year)
async function getYearlyStatisticsFromCurrentSensor(deviceId, env) {
  const deviceLower = deviceId.toLowerCase();
  const deviceUpper = deviceId.toUpperCase();

  const pvYearSensor = await fetchHA(`/api/states/sensor.device_${deviceLower}_pv_year`, env);
  if (!pvYearSensor || !pvYearSensor.attributes) {
    return { success: false, deviceId: deviceUpper, year: getCurrentVietnamYear(), message: 'ChÆ°a cÃ³ dá»¯ liá»‡u', version: VERSION };
  }

  return extractYearlyDataFromAttributes(pvYearSensor.attributes, deviceUpper, 'current_sensor');
}

// Get yearly stats from HA history (for past years)
async function getYearlyStatisticsFromHistory(deviceId, year, env) {
  const deviceLower = deviceId.toLowerCase();
  const deviceUpper = deviceId.toUpperCase();

  // Search in history around the end of the target year or start of next year
  // This is when the sensor would have had the complete year data
  const searchStartDate = `${year}-12-20T00:00:00Z`;
  const searchEndDate = `${year + 1}-01-05T23:59:59Z`;

  const entityId = `sensor.device_${deviceLower}_pv_year`;

  try {
    const historyData = await fetchHA(
      `/api/history/period/${searchStartDate}?filter_entity_id=${entityId}&end_time=${searchEndDate}`,
      env
    );

    if (!historyData || historyData.length === 0 || !historyData[0] || historyData[0].length === 0) {
      return { success: false, deviceId: deviceUpper, year, message: `KhÃ´ng cÃ³ dá»¯ liá»‡u nÄƒm ${year} trong history`, version: VERSION };
    }

    // v4.0: Find record with MAXIMUM December PV value (T12)
    // This avoids corrupt data from sensor reset at year end
    const entityHistory = historyData[0];
    let bestRecord = null;
    let maxDecemberPv = -1;

    for (const record of entityHistory) {
      if (record.attributes && record.attributes.year === year) {
        const monthlyPv = record.attributes.monthly_pv || [];
        const decemberPv = monthlyPv[11] || 0; // Index 11 = December (T12)

        // Select record with highest December PV value
        if (decemberPv > maxDecemberPv) {
          maxDecemberPv = decemberPv;
          bestRecord = record;
        }
      }
    }

    if (!bestRecord || !bestRecord.attributes) {
      // Fallback: try to find any record with monthly_pv data
      for (const record of entityHistory) {
        if (record.attributes && record.attributes.monthly_pv) {
          const monthlyPv = record.attributes.monthly_pv || [];
          const decemberPv = monthlyPv[11] || 0;
          if (decemberPv > maxDecemberPv) {
            maxDecemberPv = decemberPv;
            bestRecord = record;
          }
        }
      }
    }

    if (!bestRecord || !bestRecord.attributes) {
      return { success: false, deviceId: deviceUpper, year, message: `KhÃ´ng tÃ¬m tháº¥y dá»¯ liá»‡u nÄƒm ${year}`, version: VERSION };
    }

    // Add selection info to result
    const result = extractYearlyDataFromAttributes(bestRecord.attributes, deviceUpper, 'history_api', year);
    result.selectionMethod = 'max_december_pv';
    result.decemberPv = maxDecemberPv;
    result.recordTime = bestRecord.last_changed;

    return result;

  } catch (e) {
    return { success: false, deviceId: deviceUpper, year, error: e.message, version: VERSION };
  }
}

// Extract yearly data from sensor attributes
function extractYearlyDataFromAttributes(attrs, deviceUpper, source, overrideYear = null) {
  const sensorYear = overrideYear || attrs.year || getCurrentVietnamYear();
  const monthlyPv = attrs.monthly_pv || [];
  const monthlyLoad = attrs.monthly_load || [];
  const monthlyTotalLoad = attrs.monthly_total_load || [];
  const monthlyGrid = attrs.monthly_grid || [];
  const monthlyCharge = attrs.monthly_charge || [];
  const monthlyDischarge = attrs.monthly_discharge || [];
  const monthlyEssential = attrs.monthly_essential || [];
  const monthlySavedKwh = attrs.monthly_saved_kwh || [];
  const monthlySavingsVnd = attrs.monthly_savings_vnd || [];

  const months = [];
  let totalPv = 0, totalLoad = 0, totalGrid = 0, totalEssential = 0, totalCharge = 0, totalDischarge = 0;

  for (let i = 0; i < 12; i++) {
    const pv = monthlyPv[i] || 0;
    const load = monthlyLoad[i] || 0;
    const totalLoadMonth = monthlyTotalLoad[i] || 0;
    const grid = monthlyGrid[i] || 0;
    const charge = monthlyCharge[i] || 0;
    const discharge = monthlyDischarge[i] || 0;
    const essential = monthlyEssential[i] || 0;
    const savedKwh = monthlySavedKwh[i] || 0;
    const savingsVnd = monthlySavingsVnd[i] || 0;

    if (pv > 0 || load > 0 || totalLoadMonth > 0 || grid > 0) {
      const monthNumber = i + 1;
      const battery = charge - discharge;
      months.push({
        month: `${sensorYear}-${monthNumber.toString().padStart(2, '0')}`,
        monthNumber,
        pv: Math.round(pv * 10) / 10,
        load: Math.round(load * 10) / 10,
        totalLoad: Math.round(totalLoadMonth * 10) / 10,
        grid: Math.round(grid * 10) / 10,
        battery: Math.round(battery * 10) / 10,
        charge: Math.round(charge * 10) / 10,
        discharge: Math.round(discharge * 10) / 10,
        essential: Math.round(essential * 10) / 10,
        savedKwh: Math.round(savedKwh * 10) / 10,
        savingsVnd: Math.round(savingsVnd)
      });
      totalPv += pv;
      totalLoad += load;
      totalGrid += grid;
      totalEssential += essential;
      totalCharge += charge;
      totalDischarge += discharge;
    }
  }

  return {
    success: true,
    deviceId: deviceUpper,
    year: sensorYear,
    source,
    totalMonths: months.length,
    totals: {
      pv: Math.round(totalPv * 10) / 10,
      load: Math.round(totalLoad * 10) / 10,
      grid: Math.round(totalGrid * 10) / 10,
      essential: Math.round(totalEssential * 10) / 10,
      battery: Math.round((totalCharge - totalDischarge) * 10) / 10,
      charge: Math.round(totalCharge * 10) / 10,
      discharge: Math.round(totalDischarge * 10) / 10
    },
    months,
    timestamp: new Date().toISOString(),
    version: VERSION
  };
}

async function getSolarDashboard(deviceId, env) {
  const deviceUpper = deviceId.toUpperCase();
  const currentYear = getCurrentVietnamYear();
  const yearsToFetch = [currentYear - 2, currentYear - 1, currentYear]; // 2024, 2025, 2026

  // Fetch all years in parallel
  const yearPromises = yearsToFetch.map(year => getYearlyStatistics(deviceId, year, env));
  const yearResults = await Promise.all(yearPromises);

  // Combine all months from all years
  const allMonths = [];
  const yearsWithData = [];

  for (let i = 0; i < yearResults.length; i++) {
    const result = yearResults[i];
    const year = yearsToFetch[i];

    if (result.success && result.months && result.months.length > 0) {
      const validMonths = result.months.filter(m => (m.pv > 0 || m.load > 0));
      if (validMonths.length > 0) {
        yearsWithData.push(year);
        validMonths.forEach(m => {
          const monthNum = m.monthNumber || parseInt(String(m.month).replace('T', ''));
          allMonths.push({
            month: `${year}-${String(monthNum).padStart(2, '0')}`,
            monthNumber: monthNum,
            year: year,
            displayMonth: `T${monthNum}/${year}`,
            pv: m.pv || 0,
            load: m.load || 0,
            grid: m.grid || 0,
            essential: m.essential || 0,
            charge: m.charge || 0,
            discharge: m.discharge || 0
          });
        });
      }
    }
  }

  if (allMonths.length === 0) {
    return { success: false, hasData: false, deviceId: deviceUpper, message: 'ChÆ°a cÃ³ dá»¯ liá»‡u', version: VERSION };
  }

  // Sort by month chronologically
  allMonths.sort((a, b) => a.month.localeCompare(b.month));

  const vatRate = 0.08;
  let totalSavings = 0, totalLoad = 0, totalSolarProduced = 0, totalGrid = 0, totalCostWithoutSolar = 0;

  // Build chart data
  const chartLabels = [];
  const chartPv = [];
  const chartLoad = [];
  const chartGrid = [];
  const chartSavings = [];

  for (const month of allMonths) {
    const load = month.load || 0;
    const grid = month.grid || 0;
    const pv = month.pv || 0;

    const solarProduced = pv > 0 ? pv : Math.max(0, load - grid);
    const gridCost = calculateTieredPrice(grid, vatRate);
    const costWithoutSolar = calculateTieredPrice(load, vatRate);
    const savings = costWithoutSolar - gridCost;

    totalSavings += savings;
    totalLoad += load;
    totalSolarProduced += solarProduced;
    totalGrid += grid;
    totalCostWithoutSolar += costWithoutSolar;

    // Add to chart data
    chartLabels.push(month.displayMonth);
    chartPv.push(Math.round(pv * 10) / 10);
    chartLoad.push(Math.round(load * 10) / 10);
    chartGrid.push(Math.round(grid * 10) / 10);
    chartSavings.push(Math.round(savings));
  }

  const monthsWithData = allMonths.length;
  const avgSavings = monthsWithData > 0 ? totalSavings / monthsWithData : 0;

  const formatVND = (v) => `${Math.round(v).toLocaleString('vi-VN')} â‚«`;
  const formatKWh = (v) => `${v.toFixed(1)} kWh`;

  return {
    success: true,
    hasData: true,
    deviceId: deviceUpper,
    display: {
      totalSavings: formatVND(totalSavings),
      totalLoad: formatKWh(totalLoad),
      totalSolarProduced: formatKWh(totalSolarProduced),
      totalGrid: formatKWh(totalGrid),
      costWithoutSolar: formatVND(totalCostWithoutSolar),
      avgSavings: formatVND(avgSavings)
    },
    raw: {
      totalSavings: Math.round(totalSavings),
      totalLoad: Math.round(totalLoad * 10) / 10,
      totalSolarProduced: Math.round(totalSolarProduced * 10) / 10,
      totalGrid: Math.round(totalGrid * 10) / 10,
      costWithoutSolar: Math.round(totalCostWithoutSolar),
      avgSavings: Math.round(avgSavings)
    },
    chartData: {
      labels: chartLabels,
      pv: chartPv,
      load: chartLoad,
      grid: chartGrid,
      savings: chartSavings
    },
    months: allMonths,
    monthsWithData,
    yearsIncluded: yearsWithData,
    source: 'multi_year_aggregate',
    syncedAt: new Date().toISOString(),
    version: VERSION
  };
}

// v3.1: Generate HTML page with data and Copy button
function generateDataHtml(data, title) {
  const jsonStr = JSON.stringify(data, null, 2);
  const escapedJson = jsonStr.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Temperature-SOC-Power Worker v${VERSION}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      min-height: 100vh;
      padding: 20px;
      color: #e2e8f0;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 20px 24px;
      border-radius: 16px 16px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header h1 {
      font-size: 1.3em;
      font-weight: 700;
      color: #fff;
    }
    .header .version {
      background: rgba(255,255,255,0.2);
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      color: #fff;
    }
    .content {
      background: rgba(30, 41, 59, 0.95);
      border: 1px solid rgba(71, 85, 105, 0.4);
      border-top: none;
      border-radius: 0 0 16px 16px;
      padding: 20px;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 0.95em;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-copy {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #fff;
    }
    .btn-copy:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4); }
    .btn-copy.copied {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }
    .btn-download {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #000;
    }
    .btn-download:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(245, 158, 11, 0.4); }
    .code-block {
      background: #0f172a;
      border: 1px solid rgba(71, 85, 105, 0.4);
      border-radius: 12px;
      padding: 16px;
      overflow-x: auto;
      max-height: 500px;
      overflow-y: auto;
    }
    .code-block pre {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.85em;
      line-height: 1.5;
      color: #a5f3fc;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status {
      display: none;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 12px;
      font-weight: 500;
    }
    .status.show { display: block; }
    .status.success { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .summary {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .summary-item {
      text-align: center;
    }
    .summary-item .label {
      font-size: 0.75em;
      color: rgba(255,255,255,0.6);
      margin-bottom: 4px;
    }
    .summary-item .value {
      font-size: 1.2em;
      font-weight: 700;
      color: #10b981;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ðŸ“Š ${title}</h1>
      <span class="version">v${VERSION}</span>
    </div>
    <div class="content">
      <div id="status" class="status"></div>
      
      ${data.success && data.totals ? `
      <div class="summary">
        <div class="summary-item">
          <div class="label">â˜€ï¸ PV Generation</div>
          <div class="value">${data.totals.pv} kWh</div>
        </div>
        <div class="summary-item">
          <div class="label">ðŸ  Load</div>
          <div class="value">${data.totals.load} kWh</div>
        </div>
        <div class="summary-item">
          <div class="label">ðŸ”Œ Grid</div>
          <div class="value">${data.totals.grid} kWh</div>
        </div>
        <div class="summary-item">
          <div class="label">âš¡ Essential</div>
          <div class="value">${data.totals.essential} kWh</div>
        </div>
      </div>
      ` : ''}
      
      <div class="actions">
        <button class="btn btn-copy" onclick="copyData()">
          <span id="copyIcon">ðŸ“‹</span>
          <span id="copyText">Copy JSON</span>
        </button>
        <button class="btn btn-download" onclick="downloadData()">
          ðŸ’¾ Download JSON
        </button>
      </div>
      
      <div class="code-block">
        <pre id="jsonData">${escapedJson}</pre>
      </div>
    </div>
  </div>
  
  <script>
    const rawData = ${jsonStr};
    
    function copyData() {
      const jsonStr = JSON.stringify(rawData, null, 2);
      navigator.clipboard.writeText(jsonStr).then(() => {
        const btn = document.querySelector('.btn-copy');
        const icon = document.getElementById('copyIcon');
        const text = document.getElementById('copyText');
        btn.classList.add('copied');
        icon.textContent = 'âœ…';
        text.textContent = 'ÄÃ£ copy!';
        showStatus('âœ… ÄÃ£ copy JSON vÃ o clipboard!', 'success');
        setTimeout(() => {
          btn.classList.remove('copied');
          icon.textContent = 'ðŸ“‹';
          text.textContent = 'Copy JSON';
        }, 2000);
      }).catch(err => {
        showStatus('âŒ Lá»—i copy: ' + err.message, 'error');
      });
    }
    
    function downloadData() {
      const jsonStr = JSON.stringify(rawData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'data_${data.deviceId || 'export'}_${data.year || 'data'}.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showStatus('âœ… ÄÃ£ táº£i file JSON!', 'success');
    }
    
    function showStatus(message, type) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.className = 'status show ' + type;
      setTimeout(() => {
        status.classList.remove('show');
      }, 3000);
    }
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '*';
    const wantsHtml = url.searchParams.get('format') === 'html' ||
      request.headers.get('Accept')?.includes('text/html');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const haUrl = env.HA_URL || env.PI_URL;
    const haToken = env.HA_TOKEN || env.PI_TOKEN;

    try {
      if (path === '/' || path === '') {
        return jsonResponse({
          status: 'ok',
          version: VERSION,
          service: 'temperature-soc-power-proxy',
          features: [
            'Power History: Uses sensor series_5min_w (288 points/day)',
            'Power Peak: Uses sensor series_5min_w for accurate peaks',
            'SOC/Temperature: Multi-range History API for restart safety',
            'Full 24h data NOT affected by HA restart',
            'v3.1: Yearly stats from history for past years',
            'v3.1: HTML output with Copy button (?format=html)'
          ],
          tunnel: haUrl || 'NOT CONFIGURED',
          configured: !!(haUrl && haToken),
          timezone: 'UTC+7 (Vietnam)',
          endpoints: [
            '/api/ha/statistics/{deviceId}/year?year={YYYY}&format=html',
            '/api/solar/dashboard/{deviceId}',
            '/api/realtime/soc-history/{deviceId}?date={date}',
            '/api/realtime/power-history/{deviceId}?date={date}',
            '/api/realtime/power-peak/{deviceId}?date={date}',
            '/api/realtime/daily-energy/{deviceId}',
            '/api/cloud/temperature/{deviceId}/{date}'
          ],
          envVars: {
            HA_URL: haUrl ? 'SET' : 'MISSING',
            HA_TOKEN: haToken ? 'SET' : 'MISSING'
          }
        }, origin);
      }

      if (!haUrl || !haToken) {
        return jsonResponse({
          success: false,
          error: 'Worker not configured',
          message: 'Please set HA_URL and HA_TOKEN in Cloudflare Dashboard -> Settings -> Variables'
        }, origin, 503);
      }

      // Solar Dashboard
      const dashboardMatch = path.match(/^\/api\/solar\/dashboard\/([^\/]+)$/);
      if (dashboardMatch) {
        const data = await getSolarDashboard(dashboardMatch[1], env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Solar Dashboard - ${dashboardMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // Yearly Statistics - v3.1: supports past years from history
      const yearlyStatsMatch = path.match(/^\/api\/ha\/statistics\/([^\/]+)\/year$/);
      if (yearlyStatsMatch) {
        const deviceId = yearlyStatsMatch[1];
        const year = parseInt(url.searchParams.get('year')) || getCurrentVietnamYear();
        const data = await getYearlyStatistics(deviceId, year, env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Yearly Statistics ${year} - ${deviceId.toUpperCase()}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // Power Peak
      const peakMatch = path.match(/^\/api\/realtime\/power-peak\/([^\/]+)$/);
      if (peakMatch) {
        const date = url.searchParams.get('date') || getVietnamToday();
        const data = await getPowerPeak(peakMatch[1], date, env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Power Peak - ${peakMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // Daily Energy
      const dailyMatch = path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/);
      if (dailyMatch) {
        const data = await getDailyEnergy(dailyMatch[1], env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Daily Energy - ${dailyMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // SOC History
      const socMatch = path.match(/^\/api\/realtime\/soc-history\/([^\/]+)$/);
      if (socMatch) {
        const date = url.searchParams.get('date') || getVietnamToday();
        const data = await getSOCHistory(socMatch[1], date, env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `SOC History - ${socMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // Power History
      const powerMatch = path.match(/^\/api\/realtime\/power-history\/([^\/]+)$/);
      if (powerMatch) {
        const date = url.searchParams.get('date') || getVietnamToday();
        const data = await getPowerHistory(powerMatch[1], date, env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Power History - ${powerMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      // Temperature History
      const tempMatch = path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
      if (tempMatch) {
        const data = await getTemperatureHistory(tempMatch[1], tempMatch[2], env);
        if (wantsHtml) {
          return htmlResponse(generateDataHtml(data, `Temperature History - ${tempMatch[1]}`), origin);
        }
        return jsonResponse(data, origin);
      }

      return jsonResponse({ error: 'Not Found', path, version: VERSION }, origin, 404);
    } catch (error) {
      return jsonResponse({ success: false, error: error.message, version: VERSION }, origin, 500);
    }
  }
};