/**
 * LightEarth Full Device Worker v5.0
 * Solar Energy Monitoring System
 * 
 * v5.0 Updates:
 * - Origin protection (lumentree.pages.dev, lumentree-beta.pages.dev)
 * - Secret key access (?secret=lumentree123)
 * - Auto-fix URL (double ? to &)
 * - Removed rate limiting (handled by origin check)
 * 
 * Features:
 * - Real-time solar data (Direct HA access)
 * - Power history & analytics
 * - Temperature monitoring
 * - Device information
 * - Vietnam timezone (UTC+7)
 * - Full devices list with realtime data
 */

const VERSION = '5.0';
const VN_OFFSET_HOURS = 7;
const REALTIME_CACHE_TTL = 5;

// Security: Allowed origins and secret key
const ALLOWED_ORIGINS = [
    'https://lumentree.pages.dev',
    'https://lumentree-beta.pages.dev'
];
const SECRET_KEY = 'lumentree123';

function createSecurityHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
    };
}

function isValidDeviceId(deviceId) {
    return /^[A-Za-z0-9_-]+$/.test(deviceId);
}

// Check if request is authorized
function isAuthorized(request, url) {
    const requestOrigin = request.headers.get('Origin') || '';
    const requestReferer = request.headers.get('Referer') || '';
    const secretParam = url.searchParams.get('secret');

    const isAllowedOrigin = ALLOWED_ORIGINS.some(allowed =>
        requestOrigin.startsWith(allowed) || requestReferer.startsWith(allowed)
    );
    const hasValidSecret = secretParam === SECRET_KEY;

    return isAllowedOrigin || hasValidSecret;
}

export default {
    async fetch(request, env, ctx) {
        // Auto-fix URL: replace second ? with & (e.g., ?date=...?secret=... → ?date=...&secret=...)
        let fixedUrl = request.url;
        const firstQ = fixedUrl.indexOf('?');
        if (firstQ !== -1) {
            const afterFirstQ = fixedUrl.substring(firstQ + 1);
            if (afterFirstQ.includes('?')) {
                fixedUrl = fixedUrl.substring(0, firstQ + 1) + afterFirstQ.replace(/\?/g, '&');
            }
        }

        const url = new URL(fixedUrl);
        const path = url.pathname;
        const origin = request.headers.get('Origin');
        const headers = createSecurityHeaders(origin);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        const PI_URL = env.PI_URL || env.HA_URL || '';
        const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN || '';

        // Health check (always allowed)
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: VERSION,
                protection: 'origin + secret key',
                features: ['realtime', 'devices-full', 'power-history', 'temperature']
            }), { headers });
        }

        // Check authorization for API endpoints
        if (!isAuthorized(request, url)) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Unauthorized',
                message: 'Access denied. Invalid origin or missing secret key.',
                version: VERSION
            }), { status: 403, headers });
        }

        // /api/cloud/devices-full or /api/cloud/devices
        if (path === '/api/cloud/devices-full' || path === '/api/cloud/devices') {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable - HA not configured' }), { status: 503, headers });
            }
            try {
                const cache = caches.default;
                const cacheKey = new Request(url.toString());
                let cachedResponse = await cache.match(cacheKey);
                if (cachedResponse) {
                    const newHeaders = new Headers(cachedResponse.headers);
                    newHeaders.set('X-Cache', 'HIT');
                    return new Response(cachedResponse.body, { status: cachedResponse.status, headers: newHeaders });
                }
                const data = await fetchAllDevicesWithRealtime(PI_URL, PI_TOKEN);
                const response = new Response(JSON.stringify(data), {
                    headers: { ...headers, 'Cache-Control': `public, max-age=${REALTIME_CACHE_TTL}`, 'X-Cache': 'MISS' }
                });
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
                return response;
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Failed to fetch devices', message: error.message }), { status: 500, headers });
            }
        }

        // /api/realtime/device/{deviceId}
        if (path.match(/^\/api\/realtime\/device\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/realtime\/device\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            try {
                const cache = caches.default;
                const cacheKey = new Request(url.toString());
                let cachedResponse = await cache.match(cacheKey);
                if (cachedResponse) {
                    const newHeaders = new Headers(cachedResponse.headers);
                    newHeaders.set('X-Cache', 'HIT');
                    return new Response(cachedResponse.body, { status: cachedResponse.status, headers: newHeaders });
                }
                const data = await fetchRealtimeDeviceData(PI_URL, PI_TOKEN, deviceId);
                const response = new Response(JSON.stringify(data), {
                    headers: { ...headers, 'Cache-Control': `public, max-age=3`, 'X-Cache': 'MISS' }
                });
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
                return response;
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
            }
        }

        // /api/cloud/power-history/{deviceId}/{date}
        if (path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1], queryDate = match[2];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudPowerHistory(PI_URL, PI_TOKEN, deviceId, queryDate);
                return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        // /api/cloud/soc-history/{deviceId}/{date}
        if (path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1], queryDate = match[2];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudSOCHistory(PI_URL, PI_TOKEN, deviceId, queryDate);
                return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        // /api/cloud/temperature/{deviceId}/{date}
        if (path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1], queryDate = match[2];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudTemperatureHistory(PI_URL, PI_TOKEN, deviceId, queryDate);
                return new Response(JSON.stringify({ success: true, deviceId, date: queryDate, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        // /api/cloud/monthly/{deviceId}
        if (path.match(/^\/api\/cloud\/monthly\/([^\/]+)$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/monthly\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudMonthlyEnergy(PI_URL, PI_TOKEN, deviceId);
                return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        // Proxy to lesvr.suntcn.com
        const apiHeaders = {
            'Accept-Language': 'vi-VN,vi;q=0.8',
            'User-Agent': 'okhttp-okgo/jeasonlzy',
            'Authorization': '4A0867E6A8D90DC9E5735DBDEDD99A3A',
            'source': '2',
            'versionCode': '20241025',
            'platform': '2',
            'wifiStatus': '1'
        };

        if (path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const res = await fetch(`https://lesvr.suntcn.com/lesvr/getBatDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const res = await fetch(`https://lesvr.suntcn.com/lesvr/getPVDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const res = await fetch(`https://lesvr.suntcn.com/lesvr/getOtherDayData?queryDate=${match[2]}&deviceId=${deviceId}`, { headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Not found', path, version: VERSION }), { status: 404, headers });
    }
};

// ============================================
// Fetch all devices with realtime data
// ============================================
async function fetchAllDevicesWithRealtime(piUrl, piToken) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`HA API error: ${response.status}`);

    const states = await response.json();
    const deviceIds = new Set();
    const deviceRegex = /^sensor\.device_([a-z0-9]+)_/i;
    states.forEach(state => {
        const match = state.entity_id.match(deviceRegex);
        if (match) deviceIds.add(match[1].toUpperCase());
    });

    const devices = [];
    let totalPvPower = 0, totalLoadPower = 0, totalGridPower = 0;
    let totalPvDay = 0, totalLoadDay = 0, totalGridDay = 0, onlineCount = 0;

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

        let model = null;
        const tempEntity = deviceStates.find(s => s.entity_id.includes('_device_temperature'));
        if (tempEntity?.attributes?.friendly_name) {
            const modelMatch = tempEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i);
            if (modelMatch) model = modelMatch[1].toUpperCase().replace('KW', 'kW');
        }

        const pvPower = parseNum(getValue('pv_power'));
        const batteryPower = parseNum(getValue('battery_power'));
        const loadPower = parseNum(getValue('total_load_power')) || parseNum(getValue('load_power'));
        const gridPower = parseNum(getValue('grid_power'));
        const batterySoc = parseNum(getValue('battery_soc'));
        const temperature = parseNum(getValue('device_temperature'));

        const pvDay = parseNum(getValue('pv_today'));
        const loadDay = parseNum(getValue('total_load_today')) || parseNum(getValue('load_today'));
        const gridDay = parseNum(getValue('grid_in_today'));
        const chargeDay = parseNum(getValue('charge_today'));
        const dischargeDay = parseNum(getValue('discharge_today'));
        const exportDay = parseNum(getValue('grid_out_today')) || parseNum(getValue('essential_today'));

        if (isOnline) {
            onlineCount++;
            totalPvPower += pvPower;
            totalLoadPower += loadPower;
            totalGridPower += gridPower;
            totalPvDay += pvDay;
            totalLoadDay += loadDay;
            totalGridDay += gridDay;
        }

        devices.push({
            deviceId,
            isOnline,
            model,
            sensorCount: deviceStates.length,
            realtime: {
                batterySoc: Math.round(batterySoc),
                pvPower: Math.round(pvPower),
                batteryPower: Math.round(batteryPower),
                loadPower: Math.round(loadPower),
                gridPower: Math.round(gridPower),
                temperature: Math.round(temperature * 10) / 10
            },
            dailyEnergy: {
                pvDay: Math.round(pvDay * 100) / 100,
                loadDay: Math.round(loadDay * 100) / 100,
                gridDay: Math.round(gridDay * 100) / 100,
                chargeDay: Math.round(chargeDay * 100) / 100,
                dischargeDay: Math.round(dischargeDay * 100) / 100,
                exportDay: Math.round(exportDay * 100) / 100
            }
        });
    }

    devices.sort((a, b) => {
        if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
        return a.deviceId.localeCompare(b.deviceId);
    });

    return {
        success: true,
        source: `CloudflareWorker_HA_v${VERSION}`,
        devices,
        summary: {
            total: devices.length,
            online: onlineCount,
            offline: devices.length - onlineCount,
            totalPvPower: Math.round(totalPvPower),
            totalLoadPower: Math.round(totalLoadPower),
            totalGridPower: Math.round(totalGridPower),
            totalPvDay: Math.round(totalPvDay * 100) / 100,
            totalLoadDay: Math.round(totalLoadDay * 100) / 100,
            totalGridDay: Math.round(totalGridDay * 100) / 100
        },
        timestamp: new Date().toISOString()
    };
}

// ============================================
// Fetch realtime device data
// ============================================
async function fetchRealtimeDeviceData(piUrl, piToken, deviceId) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`HA API error: ${response.status}`);

    const states = await response.json();
    const deviceIdLower = deviceId.toLowerCase();
    const prefix = `sensor.device_${deviceIdLower}_`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));

    if (deviceStates.length === 0) {
        return { success: false, message: `Device ${deviceId} not found`, deviceId };
    }

    const getValue = (suffix) => {
        const entity = deviceStates.find(s => s.entity_id === `${prefix}${suffix}`);
        return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null;
    };
    const parseNum = (val) => val !== null ? parseFloat(val) : null;
    const parseIntVal = (val) => val !== null ? Math.round(parseFloat(val)) : null;

    let model = null;
    const pvPowerEntity = deviceStates.find(s => s.entity_id.includes('_pv_power'));
    if (pvPowerEntity?.attributes?.friendly_name) {
        const modelMatch = pvPowerEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i);
        if (modelMatch) model = modelMatch[1].toUpperCase().replace('KW', 'kW');
    }

    return {
        success: true,
        source: `CloudflareWorker_HA_v${VERSION}`,
        deviceData: {
            deviceId: deviceId.toUpperCase(),
            model,
            timestamp: new Date().toISOString(),
            pv: {
                pv1Power: parseIntVal(getValue("pv1_power")),
                pv1Voltage: parseNum(getValue("pv1_voltage")),
                pv2Power: parseIntVal(getValue("pv2_power")),
                pv2Voltage: parseNum(getValue("pv2_voltage")),
                totalPower: parseIntVal(getValue("pv_power"))
            },
            battery: {
                soc: parseIntVal(getValue("battery_soc")),
                power: parseIntVal(getValue("battery_power")),
                voltage: parseNum(getValue("battery_voltage")),
                current: parseNum(getValue("battery_current")),
                status: getValue("battery_status")
            },
            grid: {
                power: parseIntVal(getValue("grid_power")),
                status: getValue("grid_status"),
                inputVoltage: parseNum(getValue("grid_voltage")),
                inputFrequency: parseNum(getValue("ac_input_frequency"))
            },
            load: {
                homePower: parseIntVal(getValue("load_power")) || parseIntVal(getValue("total_load_power")),
                essentialPower: parseIntVal(getValue("ac_output_power"))
            },
            temperature: parseNum(getValue("device_temperature"))
        }
    };
}

// ============================================
// Fetch power history
// ============================================
async function fetchCloudPowerHistory(piUrl, piToken, deviceId, queryDate) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const sensors = {
        pv: `sensor.device_${deviceId.toLowerCase()}_pv_power`,
        battery: `sensor.device_${deviceId.toLowerCase()}_battery_power`,
        grid: `sensor.device_${deviceId.toLowerCase()}_grid_power`,
        load: `sensor.device_${deviceId.toLowerCase()}_load_power`
    };

    const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`);
    const vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
    const entityIds = Object.values(sensors).join(',');
    const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${entityIds}&minimal_response&significant_changes_only`;

    const response = await fetch(historyUrl, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const historyData = await response.json();
    const sensorTimelines = {};
    const sensorKeys = Object.keys(sensors);

    for (const sensorHistory of historyData) {
        if (!sensorHistory || sensorHistory.length === 0) continue;
        const entityId = sensorHistory[0].entity_id;
        const key = sensorKeys.find(k => sensors[k] === entityId);
        if (!key) continue;
        sensorTimelines[key] = sensorHistory
            .map(entry => ({ time: new Date(entry.last_changed || entry.last_updated).getTime(), value: parseFloat(entry.state) }))
            .filter(e => !isNaN(e.value))
            .sort((a, b) => a.time - b.time);
    }

    const timeline = [];
    const interval = 5 * 60 * 1000;
    const dayStartMs = vnDayStart.getTime();
    const dayEndMs = vnDayEnd.getTime();
    const indices = { pv: 0, battery: 0, grid: 0, load: 0 };
    const lastValues = { pv: null, battery: null, grid: null, load: null };
    const hasSeenData = { pv: false, battery: false, grid: false, load: false };

    for (let time = dayStartMs; time <= dayEndMs; time += interval) {
        for (const key of sensorKeys) {
            const sensorData = sensorTimelines[key] || [];
            while (indices[key] < sensorData.length && sensorData[indices[key]].time <= time) {
                lastValues[key] = sensorData[indices[key]].value;
                hasSeenData[key] = true;
                indices[key]++;
            }
        }
        const vnTime = new Date(time);
        const hours = vnTime.getUTCHours() + VN_OFFSET_HOURS;
        const adjustedHours = hours >= 24 ? hours - 24 : hours;
        const minutes = vnTime.getUTCMinutes();
        const localTimeStr = `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        timeline.push({
            time: localTimeStr,
            pv: hasSeenData.pv ? (lastValues.pv || 0) : 0,
            battery: hasSeenData.battery ? (lastValues.battery || 0) : 0,
            grid: hasSeenData.grid ? (lastValues.grid || 0) : 0,
            load: hasSeenData.load ? (lastValues.load || 0) : 0
        });
    }

    return {
        timeline,
        stats: {
            maxPv: Math.max(...timeline.map(t => t.pv)),
            maxLoad: Math.max(...timeline.map(t => t.load)),
            count: timeline.length
        }
    };
}

// ============================================
// Fetch SOC history
// ============================================
async function fetchCloudSOCHistory(piUrl, piToken, deviceId, queryDate) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const socEntity = `sensor.device_${deviceId.toLowerCase()}_battery_soc`;
    const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`);
    const vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
    const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${socEntity}&minimal_response`;

    const response = await fetch(historyUrl, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const historyData = await response.json();
    if (!historyData || historyData.length === 0 || historyData[0].length === 0) {
        return { timeline: [], count: 0 };
    }

    const timeline = historyData[0].map(entry => {
        const utcTime = new Date(entry.last_changed || entry.last_updated);
        const vnHours = utcTime.getUTCHours() + VN_OFFSET_HOURS;
        const adjustedHours = vnHours >= 24 ? vnHours - 24 : vnHours;
        const minutes = utcTime.getUTCMinutes();
        return {
            t: `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
            soc: parseFloat(entry.state) || 0
        };
    }).filter(entry => !isNaN(entry.soc));

    return { timeline, count: timeline.length };
}

// ============================================
// Fetch temperature history
// ============================================
async function fetchCloudTemperatureHistory(piUrl, piToken, deviceId, queryDate) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const tempEntity = `sensor.device_${deviceId.toLowerCase()}_device_temperature`;
    const vnDayStart = new Date(`${queryDate}T00:00:00+07:00`);
    const vnDayEnd = new Date(`${queryDate}T23:59:59+07:00`);
    const historyUrl = `${piUrl}/api/history/period/${vnDayStart.toISOString()}?end_time=${vnDayEnd.toISOString()}&filter_entity_id=${tempEntity}&minimal_response`;

    const response = await fetch(historyUrl, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const historyData = await response.json();
    if (!historyData || historyData.length === 0 || historyData[0].length === 0) {
        return { min: null, max: null, current: null, count: 0 };
    }

    const temps = historyData[0]
        .map(entry => parseFloat(entry.state))
        .filter(temp => !isNaN(temp) && temp > 0 && temp < 100);

    if (temps.length === 0) {
        return { min: null, max: null, current: null, count: 0 };
    }

    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const current = temps[temps.length - 1];

    let minTime = '--:--', maxTime = '--:--';
    historyData[0].forEach(entry => {
        const temp = parseFloat(entry.state);
        if (temp === min || temp === max) {
            const utcTime = new Date(entry.last_changed || entry.last_updated);
            const vnHours = utcTime.getUTCHours() + VN_OFFSET_HOURS;
            const adjustedHours = vnHours >= 24 ? vnHours - 24 : vnHours;
            const minutes = utcTime.getUTCMinutes();
            const timeStr = `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            if (temp === min) minTime = timeStr;
            if (temp === max) maxTime = timeStr;
        }
    });

    return {
        min: Math.round(min * 10) / 10,
        max: Math.round(max * 10) / 10,
        current: Math.round(current * 10) / 10,
        minTime,
        maxTime,
        count: temps.length
    };
}

// ============================================
// Fetch monthly energy
// ============================================
async function fetchCloudMonthlyEnergy(piUrl, piToken, deviceId) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const states = await response.json();
    const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
    const deviceStates = states.filter(state => state.entity_id.startsWith(devicePrefix));

    const getValue = (suffix) => {
        const entity = deviceStates.find(s => s.entity_id.endsWith(suffix));
        return entity ? parseFloat(entity.state) || 0 : 0;
    };

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return {
        month: currentMonth,
        today: {
            pv: getValue('_pv_today'),
            load: getValue('_load_today') || getValue('_total_load_today'),
            grid: getValue('_grid_in_today'),
            charge: getValue('_charge_today'),
            discharge: getValue('_discharge_today'),
            essential: getValue('_essential_today')
        },
        monthly: {
            pv: getValue('_pv_month'),
            load: getValue('_load_month'),
            grid: getValue('_grid_in_month'),
            charge: getValue('_charge_month'),
            discharge: getValue('_discharge_month'),
            essential: getValue('_essential_month')
        },
        year: {
            pv: getValue('_pv_year'),
            load: getValue('_load_year'),
            grid: getValue('_grid_in_year'),
            charge: getValue('_charge_year'),
            discharge: getValue('_discharge_year'),
            essential: getValue('_essential_year')
        },
        total: {
            pv: getValue('_pv_total'),
            load: getValue('_load_total'),
            grid: getValue('_grid_in_total'),
            charge: getValue('_charge_total'),
            discharge: getValue('_discharge_total'),
            essential: getValue('_essential_total')
        },
        timestamp: new Date().toISOString()
    };
}
