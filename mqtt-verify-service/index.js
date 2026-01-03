/**
 * MQTT Device Verification Service
 * 
 * A lightweight Express server that verifies if a Lumentree device exists
 * by subscribing to its MQTT topic and checking for data.
 * 
 * Deploy on: Render.com, Railway, Fly.io, or any Node.js hosting
 * 
 * Endpoints:
 * - GET /verify/:deviceId - Check if device has MQTT data
 * - GET /health - Health check
 */

const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MQTT Configuration (from LumentreeHA)
const MQTT_CONFIG = {
    broker: 'mqtt://lesvr.suntcn.com:1886',
    username: 'appuser',
    password: 'app666',
    keepalive: 20,
    reconnectPeriod: 0, // Don't auto-reconnect for verification
    connectTimeout: 10000 // 10 seconds
};

// Cache for verified devices (avoid repeated checks)
const verifiedDevicesCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Verify if a device exists by subscribing to its MQTT topic
 * @param {string} deviceId - Device ID to verify (e.g., P240819126)
 * @param {number} timeout - Timeout in ms (default 8000)
 * @returns {Promise<{exists: boolean, message: string, data?: object}>}
 */
async function verifyDeviceViaMQTT(deviceId, timeout = 8000) {
    const normalizedId = deviceId.toUpperCase();
    
    // Check cache first
    const cached = verifiedDevicesCache.get(normalizedId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`[Cache] Device ${normalizedId}: exists=${cached.exists}`);
        return { ...cached, cached: true };
    }
    
    return new Promise((resolve) => {
        const topic = `reportApp/${normalizedId}`;
        let client = null;
        let resolved = false;
        let timeoutId = null;
        
        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (client) {
                try {
                    client.end(true);
                } catch (e) {
                    console.warn(`[MQTT] Error closing client: ${e.message}`);
                }
            }
        };
        
        const resolveOnce = (result) => {
            if (resolved) return;
            resolved = true;
            cleanup();
            
            // Cache the result
            verifiedDevicesCache.set(normalizedId, {
                ...result,
                timestamp: Date.now()
            });
            
            resolve(result);
        };
        
        console.log(`[MQTT] Connecting to verify device ${normalizedId}...`);
        
        try {
            client = mqtt.connect(MQTT_CONFIG.broker, {
                username: MQTT_CONFIG.username,
                password: MQTT_CONFIG.password,
                clientId: `verify-${normalizedId}-${Date.now()}`,
                keepalive: MQTT_CONFIG.keepalive,
                reconnectPeriod: MQTT_CONFIG.reconnectPeriod,
                connectTimeout: MQTT_CONFIG.connectTimeout
            });
            
            client.on('connect', () => {
                console.log(`[MQTT] Connected, subscribing to ${topic}...`);
                client.subscribe(topic, { qos: 0 }, (err) => {
                    if (err) {
                        console.error(`[MQTT] Subscribe error: ${err.message}`);
                        resolveOnce({
                            exists: null,
                            deviceId: normalizedId,
                            message: 'MQTT subscribe failed',
                            error: err.message
                        });
                    }
                });
            });
            
            client.on('message', (receivedTopic, message) => {
                console.log(`[MQTT] Received message on ${receivedTopic}: ${message.length} bytes`);
                
                if (receivedTopic === topic) {
                    // Device exists and is sending data!
                    resolveOnce({
                        exists: true,
                        deviceId: normalizedId,
                        message: `Device ${normalizedId} is active and sending data`,
                        dataLength: message.length
                    });
                }
            });
            
            client.on('error', (err) => {
                console.error(`[MQTT] Connection error: ${err.message}`);
                resolveOnce({
                    exists: null,
                    deviceId: normalizedId,
                    message: 'MQTT connection error',
                    error: err.message
                });
            });
            
            client.on('offline', () => {
                console.warn(`[MQTT] Client went offline`);
            });
            
            // Timeout - no data received
            timeoutId = setTimeout(() => {
                console.log(`[MQTT] Timeout waiting for ${normalizedId} data`);
                resolveOnce({
                    exists: false,
                    deviceId: normalizedId,
                    message: `Device ${normalizedId} không có dữ liệu MQTT sau ${timeout/1000}s`,
                    hint: 'Kiểm tra: 1) Chữ cái đầu H/P có đúng không? 2) Thiết bị có đang bật không?'
                });
            }, timeout);
            
        } catch (err) {
            console.error(`[MQTT] Setup error: ${err.message}`);
            resolveOnce({
                exists: null,
                deviceId: normalizedId,
                message: 'MQTT setup failed',
                error: err.message
            });
        }
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'mqtt-verify',
        version: '1.0.0',
        cacheSize: verifiedDevicesCache.size
    });
});

// Verify device endpoint
app.get('/verify/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    const timeout = parseInt(req.query.timeout) || 8000;
    
    // Validate device ID format
    if (!/^[HP]\d{9}$/i.test(deviceId)) {
        return res.status(400).json({
            success: false,
            exists: false,
            deviceId: deviceId,
            error: 'Invalid device ID format',
            message: 'Device ID phải có format: H hoặc P + 9 số. VD: H240819126, P250801055'
        });
    }
    
    console.log(`[API] Verify request for ${deviceId}, timeout=${timeout}ms`);
    
    try {
        const result = await verifyDeviceViaMQTT(deviceId, timeout);
        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error(`[API] Verify error: ${err.message}`);
        res.status(500).json({
            success: false,
            exists: null,
            deviceId: deviceId,
            error: err.message
        });
    }
});

// Clear cache endpoint (for testing)
app.delete('/cache', (req, res) => {
    const sizeBefore = verifiedDevicesCache.size;
    verifiedDevicesCache.clear();
    res.json({
        success: true,
        message: `Cleared ${sizeBefore} cached entries`
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MQTT Verify Service running on port ${PORT}`);
    console.log(`📡 MQTT Broker: ${MQTT_CONFIG.broker}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET /health - Health check`);
    console.log(`  GET /verify/:deviceId - Verify device exists`);
    console.log(`  DELETE /cache - Clear verification cache`);
});
