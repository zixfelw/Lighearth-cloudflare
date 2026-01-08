/**
 * LightEarth Realtime API Worker v1.0
 * ONLY Realtime endpoints - Optimized for speed
 * 
 * Endpoints:
 * - /health - Health check
 * - /api/realtime/device/{deviceId} - Realtime device data
 * - /api/realtime/daily-energy/{deviceId} - Daily energy stats
 * 
 * Optimizations:
 * - Only realtime endpoints (no heavy /api/cloud/*)
 * - 3 second cache for realtime data
 * - Minimal code for faster CPU execution
 */

const REALTIME_CACHE_TTL = 3;

function headers() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

function isValidDeviceId(id) {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const h = headers();

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: h });
        }

        const PI_URL = env.PI_URL || env.HA_URL || '';
        const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN || '';

        // Health check
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: 'realtime-v1.0',
                endpoints: ['/api/realtime/device/{id}', '/api/realtime/daily-energy/{id}'],
                cache: `${REALTIME_CACHE_TTL}s`
            }), { headers: h });
        }

        // /api/realtime/device/{deviceId}
        if (path.match(/^\/api\/realtime\/device\/([^\/]+)$/)) {
            const deviceId = path.match(/^\/api\/realtime\/device\/([^\/]+)$/)[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers: h });
            }

            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'HA not configured' }), { status: 503, headers: h });
            }

            try {
                // Check cache
                const cache = caches.default;
                const cacheKey = new Request(url.toString());
                const cached = await cache.match(cacheKey);

                if (cached) {
                    const nh = new Headers(cached.headers);
                    nh.set('X-Cache', 'HIT');
                    return new Response(cached.body, { status: cached.status, headers: nh });
                }

                // Fetch from HA
                const data = await fetchRealtimeDevice(PI_URL, PI_TOKEN, deviceId);

                const response = new Response(JSON.stringify(data), {
                    headers: { ...h, 'Cache-Control': `public, max-age=${REALTIME_CACHE_TTL}`, 'X-Cache': 'MISS' }
                });

                ctx.waitUntil(cache.put(cacheKey, response.clone()));
                return response;

            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: h });
            }
        }

        // /api/realtime/daily-energy/{deviceId}
        if (path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/)) {
            const deviceId = path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/)[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID' }), { status: 400, headers: h });
            }

            if (!PI_URL || !PI_TOKEN) {
                return new Response(JSON.stringify({ success: false, error: 'HA not configured' }), { status: 503, headers: h });
            }

            try {
                const data = await fetchDailyEnergy(PI_URL, PI_TOKEN, deviceId);
                return new Response(JSON.stringify({ success: true, deviceId, ...data }), { headers: h });
            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: h });
            }
        }

        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: h });
    }
};

// Fetch realtime device data from HA
async function fetchRealtimeDevice(piUrl, piToken, deviceId) {
    const res = await fetch(`${piUrl}/api/states`, {
        headers: { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`HA error: ${res.status}`);

    const states = await res.json();
    const prefix = `sensor.device_${deviceId.toLowerCase()}_`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));

    if (deviceStates.length === 0) {
        return { success: false, message: `Device ${deviceId} not found`, deviceId, timestamp: new Date().toISOString() };
    }

    const get = (suffix) => {
        const e = deviceStates.find(s => s.entity_id === `${prefix}${suffix}`);
        return e?.state !== 'unavailable' && e?.state !== 'unknown' ? e?.state : null;
    };

    const num = (v) => v !== null ? parseFloat(v) : null;
    const int = (v) => v !== null ? Math.round(parseFloat(v)) : null;

    // Model from friendly_name
    let model = null;
    const pvE = deviceStates.find(s => s.entity_id.includes('_pv_power'));
    if (pvE?.attributes?.friendly_name) {
        const m = pvE.attributes.friendly_name.match(/^(SUNT-[\d.]+[kK][wW]-[A-Z]+)/i);
        if (m) model = m[1].toUpperCase().replace('KW', 'kW');
    }

    // Battery cells
    const cellE = deviceStates.find(s => s.entity_id === `${prefix}battery_cell_info`);
    let batteryCells = null;
    if (cellE?.attributes) {
        const a = cellE.attributes;
        const cells = [];
        const co = a.cells || {};
        for (let i = 1; i <= 16; i++) {
            const k = `c_${String(i).padStart(2, '0')}`;
            if (co[k] !== undefined) cells.push({ cell: i, voltage: num(co[k]) });
        }
        if (cells.length > 0 || a.avg) {
            batteryCells = { num: a.num || cells.length || 16, avg: num(a.avg), min: num(a.min), max: num(a.max), diff: num(a.diff), cells, rawCells: co };
        }
    }

    return {
        success: true,
        source: "RealtimeWorker_v1.0",
        deviceData: {
            deviceId: deviceId.toUpperCase(),
            model,
            timestamp: new Date().toISOString(),
            pv: {
                pv1Power: int(get("pv1_power")),
                pv1Voltage: num(get("pv1_voltage")),
                pv2Power: int(get("pv2_power")),
                pv2Voltage: num(get("pv2_voltage")),
                totalPower: int(get("pv_power"))
            },
            battery: {
                soc: int(get("battery_soc")),
                power: int(get("battery_power")),
                voltage: num(get("battery_voltage")),
                current: num(get("battery_current")),
                status: get("battery_status")
            },
            batteryCells,
            grid: {
                power: int(get("grid_power")),
                status: get("grid_status"),
                inputVoltage: num(get("grid_voltage")),
                inputFrequency: num(get("ac_input_frequency"))
            },
            acOutput: {
                power: int(get("ac_output_power")),
                voltage: num(get("ac_output_voltage")),
                frequency: num(get("ac_output_frequency"))
            },
            load: {
                homePower: int(get("load_power")) || int(get("total_load_power")),
                essentialPower: int(get("ac_output_power"))
            },
            temperature: num(get("device_temperature"))
        }
    };
}

// Fetch daily energy data
async function fetchDailyEnergy(piUrl, piToken, deviceId) {
    const res = await fetch(`${piUrl}/api/states`, {
        headers: { 'Authorization': `Bearer ${piToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`HA error: ${res.status}`);

    const states = await res.json();
    const prefix = `sensor.device_${deviceId.toLowerCase()}`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));

    const get = (suffix) => {
        const e = deviceStates.find(s => s.entity_id.endsWith(suffix));
        return e ? parseFloat(e.state) || 0 : 0;
    };

    return {
        today: {
            pv: get('_pv_today'),
            load: get('_load_today'),
            gridIn: get('_grid_in_today'),
            gridOut: get('_grid_out_today'),
            charge: get('_charge_today'),
            discharge: get('_discharge_today'),
            essential: get('_essential_today')
        },
        timestamp: new Date().toISOString()
    };
}
