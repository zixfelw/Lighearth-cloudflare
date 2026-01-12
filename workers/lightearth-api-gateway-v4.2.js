/**
 * LightEarth API Gateway v4.2
 * Solar Energy Monitoring System
 * 
 * v4.2 Updates:
 * - Origin protection (lumentree.pages.dev, lumentree-beta.pages.dev)
 * - Secret key access (?secret=lumentree123)
 * - Auto-fix URL (double ? to &)
 * 
 * Features:
 * - Real-time solar data (Direct HA access - no Railway needed!)
 * - Power history & analytics
 * - Temperature monitoring
 * - Device information
 * - Battery cell info (16 cells voltage)
 * - Vietnam timezone (UTC+7)
 * 
 * Security:
 * - Origin validation for API endpoints
 * - Secret key for direct access
 * - Basic CORS headers
 * - Input sanitization for device IDs
 */

const VERSION = '4.2';
const VN_OFFSET_HOURS = 7;
const REALTIME_CACHE_TTL = 3;

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

        const apiHeaders = {
            'Accept-Language': 'vi-VN,vi;q=0.8',
            'User-Agent': 'okhttp-okgo/jeasonlzy',
            'Authorization': '4A0867E6A8D90DC9E5735DBDEDD99A3A',
            'source': '2',
            'versionCode': '20241025',
            'platform': '2',
            'wifiStatus': '1'
        };

        const PI_URL = env.PI_URL || env.HA_URL || '';
        const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN || '';

        // Health check (always allowed)
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: VERSION,
                protection: 'origin + secret key',
                features: ['realtime', 'power-history', 'soc-history', 'temperature', 'device-info']
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

        // ============================================
        // /api/realtime/device/{deviceId} - Direct HA access!
        // ============================================
        if (path.match(/^\/api\/realtime\/device\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/realtime\/device\/([^\/]+)$/);
            const deviceId = match[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Invalid device ID'
                }), { status: 400, headers });
            }

            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Service unavailable - HA not configured'
                }), { status: 503, headers });
            }

            try {
                // Check cache first
                const cache = caches.default;
                const cacheKey = new Request(url.toString());
                let cachedResponse = await cache.match(cacheKey);

                if (cachedResponse) {
                    const newHeaders = new Headers(cachedResponse.headers);
                    newHeaders.set('X-Cache', 'HIT');
                    return new Response(cachedResponse.body, {
                        status: cachedResponse.status,
                        headers: newHeaders
                    });
                }

                // Cache miss - fetch from HA
                const data = await fetchRealtimeDeviceData(PI_URL, PI_TOKEN, deviceId);

                const response = new Response(JSON.stringify(data), {
                    headers: {
                        ...headers,
                        'Cache-Control': `public, max-age=${REALTIME_CACHE_TTL}`,
                        'X-Cache': 'MISS'
                    }
                });

                // Store in cache
                ctx.waitUntil(cache.put(cacheKey, response.clone()));

                return response;

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Failed to fetch realtime data',
                    message: error.message
                }), { status: 500, headers });
            }
        }

        // ============================================
        // /api/realtime/daily-energy/{deviceId} - Daily energy stats
        // ============================================
        if (path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/);
            const deviceId = match[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }

            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }

            try {
                const data = await fetchDailyEnergyData(PI_URL, PI_TOKEN, deviceId);
                return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        // Cloud API Endpoints

        if (path === '/api/cloud/devices') {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            try {
                const data = await fetchCloudDevices(PI_URL, PI_TOKEN);
                return new Response(JSON.stringify({ success: true, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

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

        if (path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/power-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            const queryDate = match[2];
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

        if (path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/soc-history\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            const queryDate = match[2];
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

        if (path.match(/^\/api\/cloud\/states\/([^\/]+)$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/states\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudStates(PI_URL, PI_TOKEN, deviceId);
                return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        if (path.match(/^\/api\/cloud\/device-info\/([^\/]+)$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/device-info\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers });
            }
            try {
                const data = await fetchCloudDeviceInfo(PI_URL, PI_TOKEN, deviceId);
                return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: 'Request failed' }), { status: 500, headers });
            }
        }

        if (path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'Service unavailable' }), { status: 503, headers });
            }
            const match = path.match(/^\/api\/cloud\/temperature\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            const queryDate = match[2];
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

        // LightEarth Public API Endpoints (Proxy to lesvr.suntcn.com)

        if (path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/bat\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getBatDayData?queryDate=${match[2]}&deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/pv\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getPVDayData?queryDate=${match[2]}&deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/)) {
            const match = path.match(/^\/api\/other\/([^\/]+)\/(\d{4}-\d{2}-\d{2})$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getOtherDayData?queryDate=${match[2]}&deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/month\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/month\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getMonthData?deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/year\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/year\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getYearData?deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path.match(/^\/api\/history-year\/([^\/]+)$/)) {
            const match = path.match(/^\/api\/history-year\/([^\/]+)$/);
            const deviceId = match[1];
            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ error: 'Invalid device ID' }), { status: 400, headers });
            }
            const apiUrl = `https://lesvr.suntcn.com/lesvr/getHistoryYearData?deviceId=${deviceId}`;
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path === '/api/device') {
            try {
                const res = await fetch('https://lesvr.suntcn.com/lesvr/getDevice', { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path === '/api/share-devices') {
            try {
                const res = await fetch('https://lesvr.suntcn.com/lesvr/shareDevices', { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path === '/api/app-param') {
            try {
                const res = await fetch('https://lesvr.suntcn.com/app/getAppParam', { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        if (path === '/api/check-update') {
            try {
                const res = await fetch('https://lesvr.suntcn.com/lesvr/checkUpdate', { method: 'GET', headers: apiHeaders });
                return new Response(JSON.stringify(await res.json()), { headers });
            } catch (error) {
                return new Response(JSON.stringify({ error: 'Upstream API error', message: error.message }), { status: 502, headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Not found', version: VERSION }), { status: 404, headers });
    }
};

// ============================================
// Fetch realtime device data directly from HA
// ============================================
async function fetchRealtimeDeviceData(piUrl, piToken, deviceId) {
    const cloudHeaders = {
        'Authorization': `Bearer ${piToken}`,
        'Content-Type': 'application/json'
    };

    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) {
        throw new Error(`HA API error: ${response.status}`);
    }

    const states = await response.json();
    const deviceIdLower = deviceId.toLowerCase();
    const prefix = `sensor.device_${deviceIdLower}_`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));

    if (deviceStates.length === 0) {
        return {
            success: false,
            message: `Device ${deviceId} not found`,
            deviceId: deviceId,
            timestamp: new Date().toISOString()
        };
    }

    const getValue = (suffix) => {
        const entity = deviceStates.find(s => s.entity_id === `${prefix}${suffix}`);
        return entity?.state !== 'unavailable' && entity?.state !== 'unknown' ? entity?.state : null;
    };

    const parseNum = (val) => val !== null ? parseFloat(val) : null;
    const parseIntVal = (val) => val !== null ? Math.round(parseFloat(val)) : null;

    // Extract model from friendly_name
    let model = null;
    const pvPowerEntity = deviceStates.find(s => s.entity_id.includes('_pv_power'));
    if (pvPowerEntity?.attributes?.friendly_name) {
        const modelMatch = pvPowerEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i);
        if (modelMatch) model = modelMatch[1].toUpperCase().replace('KW', 'kW');
    }

    // Get battery cell info from attributes
    const batteryCellEntity = deviceStates.find(s => s.entity_id === `${prefix}battery_cell_info`);
    let batteryCells = null;
    if (batteryCellEntity?.attributes) {
        const attrs = batteryCellEntity.attributes;
        const cellsObj = attrs.cells || {};
        const cellVoltages = [];

        for (let i = 1; i <= 16; i++) {
            const key = `c_${String(i).padStart(2, '0')}`;
            if (cellsObj[key] !== undefined) {
                cellVoltages.push({
                    cell: i,
                    voltage: parseNum(cellsObj[key])
                });
            }
        }

        if (cellVoltages.length > 0 || attrs.num || attrs.avg) {
            batteryCells = {
                num: attrs.num || cellVoltages.length || 16,
                avg: parseNum(attrs.avg),
                min: parseNum(attrs.min),
                max: parseNum(attrs.max),
                diff: parseNum(attrs.diff),
                cells: cellVoltages,
                rawCells: cellsObj
            };
        }
    }

    return {
        success: true,
        source: `CloudflareWorker_HA_v${VERSION}`,
        deviceData: {
            deviceId: deviceId.toUpperCase(),
            model: model,
            deviceType: model,
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
            batteryCells: batteryCells,
            grid: {
                power: parseIntVal(getValue("grid_power")),
                status: getValue("grid_status"),
                inputVoltage: parseNum(getValue("grid_voltage")),
                inputFrequency: parseNum(getValue("ac_input_frequency"))
            },
            acOutput: {
                power: parseIntVal(getValue("ac_output_power")),
                voltage: parseNum(getValue("ac_output_voltage")),
                frequency: parseNum(getValue("ac_output_frequency"))
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
// Fetch daily energy data
// ============================================
async function fetchDailyEnergyData(piUrl, piToken, deviceId) {
    const cloudHeaders = {
        'Authorization': `Bearer ${piToken}`,
        'Content-Type': 'application/json'
    };

    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const states = await response.json();
    const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
    const deviceStates = states.filter(state => state.entity_id.startsWith(devicePrefix));

    const getValue = (suffix) => {
        const entity = deviceStates.find(s => s.entity_id.endsWith(suffix));
        return entity ? parseFloat(entity.state) || 0 : 0;
    };

    return {
        today: {
            pv: getValue('_pv_today'),
            load: getValue('_load_today'),
            gridIn: getValue('_grid_in_today'),
            gridOut: getValue('_grid_out_today'),
            charge: getValue('_charge_today'),
            discharge: getValue('_discharge_today'),
            essential: getValue('_essential_today')
        },
        timestamp: new Date().toISOString()
    };
}

// Cloud API Helper Functions

async function fetchCloudDevices(piUrl, piToken) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const states = await response.json();
    const deviceIds = new Set();
    const deviceRegex = /^sensor\.device_([a-z0-9]+)_/i;

    states.forEach(state => {
        const match = state.entity_id.match(deviceRegex);
        if (match) deviceIds.add(match[1].toUpperCase());
    });

    const devices = [];
    for (const deviceId of deviceIds) {
        const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
        const deviceStates = states.filter(s => s.entity_id.startsWith(devicePrefix));

        let model = null;
        const pvPowerEntity = deviceStates.find(s => s.entity_id.includes('_pv_power'));
        if (pvPowerEntity?.attributes?.friendly_name) {
            const modelMatch = pvPowerEntity.attributes.friendly_name.match(/^(SUNT-[\d.]+kW-[A-Z]+)/i);
            if (modelMatch) model = modelMatch[1];
        }

        const socEntity = deviceStates.find(s => s.entity_id.includes('_battery_soc'));
        const pvPower = deviceStates.find(s => s.entity_id.includes('_pv_power'));

        devices.push({
            deviceId,
            model,
            sensorCount: deviceStates.length,
            batterySoc: socEntity ? parseFloat(socEntity.state) || 0 : null,
            pvPower: pvPower ? parseFloat(pvPower.state) || 0 : null,
            online: pvPower && pvPower.state !== 'unavailable'
        });
    }

    return {
        devices: devices.sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
        count: devices.length,
        timestamp: new Date().toISOString()
    };
}

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
            pv: getValue('_pv_today'), load: getValue('_load_today'), grid: getValue('_grid_in_today'),
            charge: getValue('_charge_today'), discharge: getValue('_discharge_today'), essential: getValue('_essential_today')
        },
        monthly: {
            pv: getValue('_pv_month'), load: getValue('_load_month'), grid: getValue('_grid_in_month'),
            charge: getValue('_charge_month'), discharge: getValue('_discharge_month'), essential: getValue('_essential_month')
        },
        year: {
            pv: getValue('_pv_year'), load: getValue('_load_year'), grid: getValue('_grid_in_year'),
            charge: getValue('_charge_year'), discharge: getValue('_discharge_year'), essential: getValue('_essential_year')
        },
        total: {
            pv: getValue('_pv_total'), load: getValue('_load_total'), grid: getValue('_grid_in_total'),
            charge: getValue('_charge_total'), discharge: getValue('_discharge_total'), essential: getValue('_essential_total')
        },
        timestamp: new Date().toISOString()
    };
}

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
    const startTimeUTC = vnDayStart.toISOString();
    const endTimeUTC = vnDayEnd.toISOString();

    const entityIds = Object.values(sensors).join(',');
    const historyUrl = `${piUrl}/api/history/period/${startTimeUTC}?end_time=${endTimeUTC}&filter_entity_id=${entityIds}&minimal_response&significant_changes_only`;

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
        stats: { maxPv: Math.max(...timeline.map(t => t.pv)), maxLoad: Math.max(...timeline.map(t => t.load)), count: timeline.length }
    };
}

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
        return { t: `${String(adjustedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, soc: parseFloat(entry.state) || 0 };
    }).filter(entry => !isNaN(entry.soc));

    return { timeline, count: timeline.length };
}

async function fetchCloudStates(piUrl, piToken, deviceId) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };
    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const states = await response.json();
    const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
    const deviceStates = states.filter(state => state.entity_id.startsWith(devicePrefix));

    const result = { timestamp: new Date().toISOString(), entities: {} };
    deviceStates.forEach(state => {
        const shortName = state.entity_id.replace(devicePrefix + '_', '');
        result.entities[shortName] = { state: state.state, unit: state.attributes?.unit_of_measurement || '' };
    });

    return result;
}

async function fetchCloudDeviceInfo(piUrl, piToken, deviceId) {
    const cloudHeaders = { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' };

    const response = await fetch(`${piUrl}/api/states`, { headers: cloudHeaders });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const states = await response.json();
    const devicePrefix = `sensor.device_${deviceId.toLowerCase()}`;
    const deviceEntity = states.find(state => state.entity_id.startsWith(devicePrefix));

    if (!deviceEntity) {
        return { model: null, manufacturer: null, sw_version: null, hw_version: null, error: 'Device not found' };
    }

    try {
        const configResponse = await fetch(`${piUrl}/api/config/device_registry`, { headers: cloudHeaders });
        if (configResponse.ok) {
            const devices = await configResponse.json();
            const device = devices.find(d => {
                if (d.identifiers) return JSON.stringify(d.identifiers).toLowerCase().includes(deviceId.toLowerCase());
                if (d.name) return d.name.toLowerCase().includes(deviceId.toLowerCase());
                return false;
            });

            if (device) {
                return {
                    model: device.model || null,
                    manufacturer: device.manufacturer || null,
                    sw_version: device.sw_version || null,
                    hw_version: device.hw_version || null,
                    name: device.name || null,
                    area: device.area_id || null
                };
            }
        }
    } catch (e) { }

    const attrs = deviceEntity.attributes || {};
    return {
        model: attrs.model || attrs.device_class || null,
        manufacturer: attrs.manufacturer || null,
        sw_version: attrs.sw_version || null,
        hw_version: attrs.hw_version || null,
        friendly_name: attrs.friendly_name || null,
        entity_id: deviceEntity.entity_id
    };
}

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

    const temps = historyData[0].map(entry => parseFloat(entry.state)).filter(temp => !isNaN(temp) && temp > 0 && temp < 100);

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
        minTime, maxTime,
        count: temps.length
    };
}
