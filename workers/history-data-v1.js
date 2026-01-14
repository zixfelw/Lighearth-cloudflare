/**
 * LightEarth History Data Worker v1.0
 * Fetch historical data directly from Lumentree Cloud API
 * 
 * Endpoints:
 * - /health - Health check
 * - /api/history/daily/{deviceId}?date=YYYY-MM-DD&token=xxx - Daily data (PV, Grid, Load)
 * - /api/history/monthly/{deviceId}?year=YYYY&month=MM&token=xxx - Monthly totals
 * - /api/history/bulk?devices=id1,id2&date=YYYY-MM-DD&token=xxx - Bulk daily data
 * 
 * Note: Each device requires its own token from Lumentree
 */

const VERSION = 'history-data-v1.0';
const LUMENTREE_BASE = 'http://lesvr.suntcn.com/lesvr';

// Default headers for Lumentree API
function lumentreeHeaders(token) {
    return {
        'Authorization': token,
        'versionCode': '1.6.3',
        'platform': '2',
        'wifiStatus': '1',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G970F)',
        'Accept': 'application/json, text/plain, */*'
    };
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json',
    };
}

// Fetch daily data from Lumentree
async function fetchDailyData(deviceId, date, token) {
    const headers = lumentreeHeaders(token);

    // Parallel fetch PV and Other (Grid+Load) data
    const [pvRes, otherRes, batRes] = await Promise.all([
        fetch(`${LUMENTREE_BASE}/getPVDayData?queryDate=${date}&deviceId=${deviceId}`, { headers }),
        fetch(`${LUMENTREE_BASE}/getOtherDayData?queryDate=${date}&deviceId=${deviceId}`, { headers }),
        fetch(`${LUMENTREE_BASE}/getBatDayData?queryDate=${date}&deviceId=${deviceId}`, { headers })
    ]);

    const pvData = await pvRes.json();
    const otherData = await otherRes.json();
    const batData = await batRes.json();

    const result = {
        deviceId,
        date,
        timestamp: new Date().toISOString(),
        pv: null,
        grid: null,
        load: null,
        charge: null,
        discharge: null
    };

    // Parse PV data
    if (pvData.returnValue === 1 && pvData.data?.pv?.tableValue) {
        result.pv = pvData.data.pv.tableValue / 10.0;
    }

    // Parse Grid and Load data
    if (otherData.returnValue === 1 && otherData.data) {
        if (otherData.data.grid?.tableValue) {
            result.grid = otherData.data.grid.tableValue / 10.0;
        }
        if (otherData.data.homeload?.tableValue) {
            result.load = otherData.data.homeload.tableValue / 10.0;
        }
    }

    // Parse Battery data
    if (batData.returnValue === 1 && batData.data?.bats) {
        if (batData.data.bats[0]?.tableValue) {
            result.charge = batData.data.bats[0].tableValue / 10.0;
        }
        if (batData.data.bats[1]?.tableValue) {
            result.discharge = batData.data.bats[1].tableValue / 10.0;
        }
    }

    return result;
}

// Fetch entire month data
async function fetchMonthlyData(deviceId, year, month, token) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const results = [];
    let totalPv = 0, totalGrid = 0, totalLoad = 0, totalCharge = 0, totalDischarge = 0;

    // Fetch all days in parallel (batch of 5 to avoid rate limiting)
    for (let day = 1; day <= daysInMonth; day += 5) {
        const batch = [];
        for (let d = day; d < day + 5 && d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            batch.push(fetchDailyData(deviceId, dateStr, token));
        }
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);

        // Small delay between batches
        await new Promise(r => setTimeout(r, 100));
    }

    // Sum up totals
    for (const day of results) {
        if (day.pv) totalPv += day.pv;
        if (day.grid) totalGrid += day.grid;
        if (day.load) totalLoad += day.load;
        if (day.charge) totalCharge += day.charge;
        if (day.discharge) totalDischarge += day.discharge;
    }

    return {
        deviceId,
        year,
        month,
        daysWithData: results.filter(r => r.pv > 0).length,
        totals: {
            pv: Math.round(totalPv * 10) / 10,
            grid: Math.round(totalGrid * 10) / 10,
            load: Math.round(totalLoad * 10) / 10,
            charge: Math.round(totalCharge * 10) / 10,
            discharge: Math.round(totalDischarge * 10) / 10
        },
        dailyData: results
    };
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const h = corsHeaders();

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: h });
        }

        // Health check
        if (path === '/' || path === '/health') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: VERSION,
                endpoints: [
                    'GET /api/history/daily/{deviceId}?date=YYYY-MM-DD&token=xxx',
                    'GET /api/history/monthly/{deviceId}?year=YYYY&month=MM&token=xxx',
                    'GET /api/history/bulk?devices=id1,id2&date=YYYY-MM-DD&tokens=tok1,tok2'
                ]
            }), { headers: h });
        }

        // Daily data: /api/history/daily/{deviceId}
        const dailyMatch = path.match(/^\/api\/history\/daily\/([^\/]+)$/);
        if (dailyMatch) {
            const deviceId = dailyMatch[1];
            const date = url.searchParams.get('date');
            const token = url.searchParams.get('token');

            if (!date || !token) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing date or token parameter'
                }), { status: 400, headers: h });
            }

            try {
                const data = await fetchDailyData(deviceId, date, token);
                return new Response(JSON.stringify({ success: true, ...data }), { headers: h });
            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: h });
            }
        }

        // Monthly data: /api/history/monthly/{deviceId}
        const monthlyMatch = path.match(/^\/api\/history\/monthly\/([^\/]+)$/);
        if (monthlyMatch) {
            const deviceId = monthlyMatch[1];
            const year = parseInt(url.searchParams.get('year'));
            const month = parseInt(url.searchParams.get('month'));
            const token = url.searchParams.get('token');

            if (!year || !month || !token) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing year, month, or token parameter'
                }), { status: 400, headers: h });
            }

            try {
                const data = await fetchMonthlyData(deviceId, year, month, token);
                return new Response(JSON.stringify({ success: true, ...data }), { headers: h });
            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: h });
            }
        }

        // Bulk daily data: /api/history/bulk
        if (path === '/api/history/bulk') {
            const devicesParam = url.searchParams.get('devices');
            const tokensParam = url.searchParams.get('tokens');
            const date = url.searchParams.get('date');

            if (!devicesParam || !tokensParam || !date) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing devices, tokens, or date parameter'
                }), { status: 400, headers: h });
            }

            const devices = devicesParam.split(',');
            const tokens = tokensParam.split(',');

            if (devices.length !== tokens.length) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'devices and tokens count must match'
                }), { status: 400, headers: h });
            }

            try {
                // Fetch in parallel batches of 10
                const results = [];
                for (let i = 0; i < devices.length; i += 10) {
                    const batch = devices.slice(i, i + 10).map((deviceId, idx) =>
                        fetchDailyData(deviceId.trim(), date, tokens[i + idx].trim())
                    );
                    const batchResults = await Promise.all(batch);
                    results.push(...batchResults);

                    if (i + 10 < devices.length) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                }

                return new Response(JSON.stringify({
                    success: true,
                    date,
                    count: results.length,
                    data: results
                }), { headers: h });
            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: h });
            }
        }

        return new Response(JSON.stringify({
            error: 'Not found',
            version: VERSION
        }), { status: 404, headers: h });
    }
};
