/**
 * LightEarth Realtime API Worker v2.0
 * ONLY Realtime endpoints - Optimized for speed
 * 
 * Changes from v1.0:
 * - Added better User-Agent to avoid Cloudflare blocks
 * - Added retry logic for HA connection
 * - Better error handling with detailed messages
 * - Added request ID for debugging
 * - Increased cache TTL to 5s for stability
 * 
 * Endpoints:
 * - /health - Health check
 * - /api/realtime/device/{deviceId} - Realtime device data
 * - /api/realtime/daily-energy/{deviceId} - Daily energy stats
 */

const REALTIME_CACHE_TTL = 5;  // Increased from 3s for stability
const HA_TIMEOUT = 8000;  // 8 second timeout for HA requests
const MAX_RETRIES = 2;  // Retry HA connection once

function generateRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
}

function headers(requestId = null) {
    const h = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json',
    };
    if (requestId) h['X-Request-ID'] = requestId;
    return h;
}

function isValidDeviceId(id) {
    return /^[A-Za-z0-9_-]+$/.test(id);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const requestId = generateRequestId();
        const h = headers(requestId);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: h });
        }

        const PI_URL = env.PI_URL || env.HA_URL || '';
        const PI_TOKEN = env.PI_TOKEN || env.HA_TOKEN || '';

        // Fallback to primary realtime worker if this instance has no HA config
        const FALLBACK_WORKER = env.FALLBACK_WORKER || 'https://realtime.applike098.workers.dev';
        const useFallback = !PI_URL || !PI_TOKEN;

        // Health check
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: 'realtime-v2.0',
                endpoints: ['/api/realtime/device/{id}', '/api/realtime/daily-energy/{id}'],
                cache: `${REALTIME_CACHE_TTL}s`,
                timeout: `${HA_TIMEOUT}ms`,
                retries: MAX_RETRIES,
                timestamp: new Date().toISOString()
            }), { headers: h });
        }

        // /api/realtime/device/{deviceId}
        if (path.match(/^\/api\/realtime\/device\/([^\/]+)$/)) {
            const deviceId = path.match(/^\/api\/realtime\/device\/([^\/]+)$/)[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID', requestId }), { status: 400, headers: h });
            }

            // FALLBACK MODE: Forward to primary worker if no HA config
            if (useFallback) {
                console.log(`[${requestId}] No HA config, forwarding to ${FALLBACK_WORKER}`);
                try {
                    const fallbackUrl = `${FALLBACK_WORKER}/api/realtime/device/${deviceId}`;
                    const fallbackRes = await fetchWithTimeout(fallbackUrl, {
                        headers: {
                            'User-Agent': 'LightEarth-Proxy/2.0',
                            'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || 'unknown',
                            'X-Original-Request-ID': requestId
                        }
                    });

                    const data = await fallbackRes.json();
                    // Add proxy info
                    data.proxyMode = true;
                    data.proxyFrom = url.hostname;
                    data.proxiedTo = FALLBACK_WORKER;

                    return new Response(JSON.stringify(data), {
                        status: fallbackRes.status,
                        headers: { ...h, 'X-Proxy-Mode': 'fallback', 'X-Fallback-Worker': FALLBACK_WORKER }
                    });
                } catch (error) {
                    console.error(`[${requestId}] Fallback error:`, error.message);
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Fallback failed: ${error.message}`,
                        requestId,
                        fallbackWorker: FALLBACK_WORKER
                    }), { status: 502, headers: h });
                }
            }

            try {
                // Check cache
                const cache = caches.default;
                const cacheKey = new Request(url.toString());
                const cached = await cache.match(cacheKey);

                if (cached) {
                    const nh = new Headers(cached.headers);
                    nh.set('X-Cache', 'HIT');
                    nh.set('X-Request-ID', requestId);
                    return new Response(cached.body, { status: cached.status, headers: nh });
                }

                // Fetch from HA with retry
                const data = await fetchWithRetry(() => fetchRealtimeDevice(PI_URL, PI_TOKEN, deviceId, requestId), MAX_RETRIES);

                const response = new Response(JSON.stringify(data), {
                    headers: { ...h, 'Cache-Control': `public, max-age=${REALTIME_CACHE_TTL}`, 'X-Cache': 'MISS' }
                });

                ctx.waitUntil(cache.put(cacheKey, response.clone()));
                return response;

            } catch (error) {
                console.error(`[${requestId}] Error:`, error.message);
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message,
                    requestId,
                    hint: 'Check HA connection or Cloudflare Tunnel status'
                }), { status: 500, headers: h });
            }
        }

        // /api/realtime/daily-energy/{deviceId}
        if (path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/)) {
            const deviceId = path.match(/^\/api\/realtime\/daily-energy\/([^\/]+)$/)[1];

            if (!isValidDeviceId(deviceId)) {
                return new Response(JSON.stringify({ success: false, error: 'Invalid device ID', requestId }), { status: 400, headers: h });
            }

            // FALLBACK MODE: Forward to primary worker if no HA config
            if (useFallback) {
                try {
                    const fallbackUrl = `${FALLBACK_WORKER}/api/realtime/daily-energy/${deviceId}`;
                    const fallbackRes = await fetchWithTimeout(fallbackUrl, {
                        headers: { 'User-Agent': 'LightEarth-Proxy/2.0' }
                    });
                    const data = await fallbackRes.json();
                    data.proxyMode = true;
                    return new Response(JSON.stringify(data), {
                        status: fallbackRes.status,
                        headers: { ...h, 'X-Proxy-Mode': 'fallback' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Fallback failed: ${error.message}`,
                        requestId
                    }), { status: 502, headers: h });
                }
            }

            try {
                const data = await fetchWithRetry(() => fetchDailyEnergy(PI_URL, PI_TOKEN, deviceId, requestId), MAX_RETRIES);
                return new Response(JSON.stringify({ success: true, deviceId, requestId, ...data }), { headers: h });
            } catch (error) {
                console.error(`[${requestId}] Error:`, error.message);
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message,
                    requestId
                }), { status: 500, headers: h });
            }
        }

        return new Response(JSON.stringify({ error: 'Not found', requestId }), { status: 404, headers: h });
    }
};

// Retry wrapper for HA requests
async function fetchWithRetry(fn, maxRetries) {
    let lastError;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries) {
                console.log(`Retry ${i + 1}/${maxRetries} after error:`, error.message);
                await new Promise(r => setTimeout(r, 500 * (i + 1)));  // Exponential backoff
            }
        }
    }
    throw lastError;
}

// Fetch with timeout
async function fetchWithTimeout(url, options, timeoutMs = HA_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`HA request timeout after ${timeoutMs}ms`);
        }
        throw error;
    }
}

// Fetch realtime device data from HA
async function fetchRealtimeDevice(piUrl, piToken, deviceId, requestId) {
    const res = await fetchWithTimeout(`${piUrl}/api/states`, {
        headers: {
            'Authorization': `Bearer ${piToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'LightEarth-Realtime/2.0 (Cloudflare Worker)',
            'X-Request-ID': requestId
        }
    });

    if (!res.ok) {
        throw new Error(`HA error: ${res.status} ${res.statusText}`);
    }

    const states = await res.json();
    const prefix = `sensor.device_${deviceId.toLowerCase()}_`;
    const deviceStates = states.filter(s => s.entity_id.startsWith(prefix));

    if (deviceStates.length === 0) {
        return {
            success: false,
            message: `Device ${deviceId} not found in Home Assistant`,
            deviceId,
            requestId,
            timestamp: new Date().toISOString()
        };
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
            batteryCells = {
                num: a.num || cells.length || 16,
                avg: num(a.avg),
                min: num(a.min),
                max: num(a.max),
                diff: num(a.diff),
                cells,
                rawCells: co
            };
        }
    }

    return {
        success: true,
        source: "RealtimeWorker_v2.0",
        requestId,
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
async function fetchDailyEnergy(piUrl, piToken, deviceId, requestId) {
    const res = await fetchWithTimeout(`${piUrl}/api/states`, {
        headers: {
            'Authorization': `Bearer ${piToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'LightEarth-Realtime/2.0 (Cloudflare Worker)',
            'X-Request-ID': requestId
        }
    });

    if (!res.ok) {
        throw new Error(`HA error: ${res.status} ${res.statusText}`);
    }

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
        requestId,
        timestamp: new Date().toISOString()
    };
}
