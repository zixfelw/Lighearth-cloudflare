/**
 * Device Registration Worker v4.6
 * Auto-register new devices to Home Assistant via Lumentree Integration
 * WITH TELEGRAM APPROVAL FLOW + WEB REAL-TIME STATUS UPDATE + AUTO-ENABLE PV SENSORS
 * 
 * v4.6 Changes:
 * - NEW: Auto-enable PV sensors after device registration
 * - NEW: enableDefaultPVSensors() function - enables PV1, PV2, PV1 Power, PV2 Power
 * - NEW: Telegram notification shows enabled sensor count
 * - IMPROVED: Uses HA Entity Registry API to enable sensors
 * 
 * v4.4 Changes:
 * - NEW: Real-time approval status on Web UI
 * - NEW: /check/:deviceId now returns approvedBy, approvedAt info
 * - NEW: Store approval metadata in KV for web to fetch
 * - IMPROVED: Auto-refresh status every 5 seconds on web
 * - IMPROVED: Web UI shows tick when approved via Telegram
 * 
 * v4.2 Features:
 * - Telegram Approval Flow - notify admin before registering new devices
 * - /request-device endpoint - User submits device, admin gets notified
 * - /approve/:deviceId - Admin approves device registration
 * - /reject/:deviceId - Admin rejects device registration
 * - /pending-requests - List all pending device requests
 * - /telegram-webhook - Handle Telegram callback queries
 * - Prevents crash by requiring approval before adding to HA
 * 
 * Flow:
 * 1. User requests to add device (POST /request-device)
 * 2. Worker sends Telegram notification to admin with Accept/Reject buttons
 * 3. Admin clicks Accept or Reject on Telegram
 * 4. If Accept: Worker auto-adds device to HA Integration + enables PV sensors
 * 5. If Reject: User is notified, device NOT added
 * 6. Web UI auto-detects status change and shows appropriate state
 * 
 * Endpoints:
 * - GET /health - Health check
 * - GET /check/:deviceId - Check if device exists in HA (includes approval info)
 * - GET /pending-requests - List pending requests
 * - POST /request-device - Request to add new device (triggers Telegram notification)
 * - POST /approve/:deviceId - Approve device (from Telegram or API)
 * - POST /reject/:deviceId - Reject device (from Telegram or API)
 * - POST /telegram-webhook - Handle Telegram callbacks
 * - GET /config-entries - List all Lumentree config entries
 * - POST /register-integration - Direct register (for approved devices)
 * - POST /remove-entry - Remove device from integration
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
};

const LUMENTREE_DOMAIN = 'lumentree';

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = '8225131628:AAFbwEhJjuKYq94dYYErQHKXXq97ixEtNfA';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// In-memory storage for pending requests (in production, use KV or D1)
// For Cloudflare Workers, we'll use KV namespace
let pendingRequests = new Map();
let approvalHistory = new Map(); // Store approval history for web to fetch

function normalizeDeviceId(deviceId) {
    return deviceId?.toUpperCase()?.trim() || '';
}

/**
 * Validate device ID format (P/H + 9 digits)
 */
function validateDeviceIdFormat(deviceId) {
    const pattern = /^[PH]\d{9}$/i;
    return pattern.test(deviceId);
}

/**
 * Send Telegram message with inline keyboard
 */
async function sendTelegramNotification(chatId, deviceId, requestInfo) {
    const normalizedId = normalizeDeviceId(deviceId);
    const timestamp = new Date().toISOString();

    const message = `🔔 *YÊU CẦU THÊM THIẾT BỊ MỚI*

📱 *Device ID:* \`${normalizedId}\`
📅 *Thời gian:* ${timestamp}
${requestInfo?.source ? `📍 *Nguồn:* ${requestInfo.source}` : ''}
${requestInfo?.userInfo ? `👤 *User:* ${requestInfo.userInfo}` : ''}

⚠️ *Vui lòng kiểm tra Device ID trước khi duyệt!*
- Format đúng: P hoặc H + 9 chữ số
- Ví dụ ĐÚNG: P250714718
- Ví dụ SAI: H250714718 (nếu device thật là P-series)

Bấm nút bên dưới để duyệt hoặc từ chối:`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ ACCEPT', callback_data: `approve_${normalizedId}` },
                { text: '❌ REJECT', callback_data: `reject_${normalizedId}` }
            ],
            [
                { text: '🔍 Check Device', callback_data: `check_${normalizedId}` }
            ]
        ]
    };

    try {
        const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            })
        });

        const result = await response.json();
        console.log('[Telegram] Send notification result:', result.ok);
        return result;
    } catch (error) {
        console.error('[Telegram] Error sending notification:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * Edit Telegram message after action
 */
async function editTelegramMessage(chatId, messageId, newText) {
    try {
        const response = await fetch(`${TELEGRAM_API}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: newText,
                parse_mode: 'Markdown'
            })
        });
        return await response.json();
    } catch (error) {
        console.error('[Telegram] Error editing message:', error);
        return { ok: false, error: error.message };
    }
}

/**
 * Answer Telegram callback query
 */
async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
    try {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: showAlert
            })
        });
    } catch (error) {
        console.error('[Telegram] Error answering callback:', error);
    }
}

/**
 * Get bot owner/admin chat ID from bot info
 */
async function getTelegramAdminChatId(env) {
    // First check if admin chat ID is configured in env
    if (env?.TELEGRAM_ADMIN_CHAT_ID) {
        return env.TELEGRAM_ADMIN_CHAT_ID;
    }

    // Default to bot creator chat ID (from getUpdates or configured)
    // This should be set in environment variables
    // For now, we'll try to get it from recent messages
    try {
        const response = await fetch(`${TELEGRAM_API}/getUpdates?limit=10`);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            // Get the first chat ID from recent messages (usually admin)
            const firstMessage = data.result[0];
            return firstMessage.message?.chat?.id || firstMessage.callback_query?.from?.id;
        }
    } catch (error) {
        console.error('[Telegram] Error getting admin chat ID:', error);
    }

    return null;
}

/**
 * Check if device exists in Lumentree Integration
 */
async function checkDeviceInLumentreeIntegration(haUrl, haToken, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    const entityId = `sensor.device_${normalizedId.toLowerCase()}_pv_power`;

    try {
        const response = await fetch(`${haUrl}/api/states/${entityId}`, {
            headers: { 'Authorization': `Bearer ${haToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            return { exists: true, state: data.state, entityId: entityId };
        }
        return { exists: false };
    } catch (error) {
        return { exists: false, error: error.message };
    }
}

/**
 * Check device has real data in HA
 */
async function checkDeviceHasData(haUrl, haToken, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);

    try {
        const response = await fetch(`${haUrl}/api/states`, {
            headers: { 'Authorization': `Bearer ${haToken}` }
        });

        if (!response.ok) return { hasData: false, error: `HTTP ${response.status}` };

        const states = await response.json();
        const patterns = [
            `sensor.device_${normalizedId.toLowerCase()}_`,
            `sensor.lumentree_${normalizedId.toLowerCase()}_`
        ];

        const deviceEntities = states.filter(s =>
            patterns.some(p => s.entity_id.startsWith(p))
        );

        if (deviceEntities.length === 0) {
            return { hasData: false, entityCount: 0, reason: 'no_entities' };
        }

        const validStates = ['unknown', 'unavailable', null, undefined, ''];
        const entitiesWithData = deviceEntities.filter(e =>
            !validStates.includes(e.state) && !isNaN(parseFloat(e.state))
        );

        return {
            hasData: entitiesWithData.length > 0,
            entityCount: deviceEntities.length,
            entitiesWithData: entitiesWithData.length,
            sampleEntities: deviceEntities.slice(0, 5).map(e => ({
                entity_id: e.entity_id,
                state: e.state
            }))
        };
    } catch (error) {
        return { hasData: false, error: error.message };
    }
}

/**
 * Get Lumentree config entries
 */
async function getLumentreeConfigEntries(haUrl, haToken) {
    try {
        const response = await fetch(`${haUrl}/api/config/config_entries/entry`, {
            headers: { 'Authorization': `Bearer ${haToken}` }
        });
        if (!response.ok) return [];
        const entries = await response.json();
        return entries.filter(e => e.domain === LUMENTREE_DOMAIN);
    } catch (error) {
        return [];
    }
}

/**
 * Register device to Lumentree Integration via Config Flow
 */
async function registerDeviceToLumentreeIntegration(haUrl, haToken, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);

    try {
        // Step 1: Initialize config flow
        console.log(`[Register] Step 1: Init config flow for ${normalizedId}`);
        const initResponse = await fetch(`${haUrl}/api/config/config_entries/flow`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${haToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                handler: LUMENTREE_DOMAIN,
                show_advanced_options: false
            })
        });

        if (!initResponse.ok) {
            const error = await initResponse.text();
            return { success: false, error: `Init failed: ${error}` };
        }

        let flowData = await initResponse.json();
        console.log(`[Register] Flow initialized: ${flowData.flow_id}, step: ${flowData.step_id}`);

        // Step 2: Submit device_id
        if (flowData.step_id === 'user') {
            console.log(`[Register] Step 2: Submit device_id ${normalizedId}`);
            const submitResponse = await fetch(`${haUrl}/api/config/config_entries/flow/${flowData.flow_id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${haToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ device_id: normalizedId })
            });

            if (!submitResponse.ok) {
                const error = await submitResponse.text();
                return { success: false, error: `Submit device_id failed: ${error}` };
            }

            flowData = await submitResponse.json();
            console.log(`[Register] After submit: step=${flowData.step_id}, type=${flowData.type}`);
        }

        // Step 3: Handle confirm_device step
        if (flowData.step_id === 'confirm_device') {
            console.log(`[Register] Step 3: Confirm device`);
            const confirmResponse = await fetch(`${haUrl}/api/config/config_entries/flow/${flowData.flow_id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${haToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (!confirmResponse.ok) {
                const error = await confirmResponse.text();
                return { success: false, error: `Confirm failed: ${error}` };
            }

            flowData = await confirmResponse.json();
        }

        // Check final result
        if (flowData.type === 'create_entry') {
            return {
                success: true,
                message: `Device ${normalizedId} added to Lumentree Integration`,
                entryId: flowData.result?.entry_id,
                deviceName: flowData.result?.title || normalizedId
            };
        }

        if (flowData.type === 'abort') {
            return {
                success: false,
                error: flowData.reason || 'Config flow aborted',
                abortReason: flowData.reason
            };
        }

        return {
            success: false,
            error: `Unexpected flow state: ${flowData.type}`,
            step: flowData.step_id
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * v4.6 NEW: Auto-enable default PV sensors after device registration
 * Enables: PV Power (main), PV1 Power, PV2 Power, PV1 Voltage, PV2 Voltage
 * 
 * Note: HA REST API may not fully support entity registry updates.
 * We use a 30 second delay and try multiple HTTP methods.
 */
async function enableDefaultPVSensors(haUrl, haToken, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId).toLowerCase();

    // List of sensors to auto-enable (including main pv_power)
    const sensorsToEnable = [
        `sensor.device_${normalizedId}_pv_power`,     // Main PV Power
        `sensor.device_${normalizedId}_pv1_power`,    // PV1 Power
        `sensor.device_${normalizedId}_pv2_power`,    // PV2 Power
        `sensor.device_${normalizedId}_pv1_voltage`,  // PV1 Voltage
        `sensor.device_${normalizedId}_pv2_voltage`   // PV2 Voltage
    ];

    // Wait 30 seconds for HA to fully create and register entities
    console.log(`[AutoEnable] Waiting 30 seconds for HA to create entities for ${deviceId}...`);
    await new Promise(resolve => setTimeout(resolve, 30000));

    const results = [];
    const methods = ['POST', 'PATCH', 'PUT'];

    for (const entityId of sensorsToEnable) {
        let enabled = false;
        let lastError = '';

        for (const method of methods) {
            if (enabled) break;

            try {
                console.log(`[AutoEnable] Trying ${method} for ${entityId}...`);
                const response = await fetch(`${haUrl}/api/config/entity_registry/${entityId}`, {
                    method: method,
                    headers: {
                        'Authorization': `Bearer ${haToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        entity_id: entityId,
                        disabled_by: null
                    })
                });

                if (response.ok) {
                    enabled = true;
                    console.log(`[AutoEnable] ✅ ${method} success: ${entityId}`);
                } else {
                    lastError = `${method} ${response.status}`;
                    console.log(`[AutoEnable] ${method} failed: ${response.status}`);
                }
            } catch (error) {
                lastError = `${method} error: ${error.message}`;
            }
        }

        results.push({
            entityId,
            enabled,
            error: enabled ? null : lastError
        });
    }

    const enabledCount = results.filter(r => r.enabled).length;
    console.log(`[AutoEnable] Result: ${enabledCount}/${sensorsToEnable.length} sensors for ${deviceId}`);

    return {
        deviceId: normalizedId,
        enabledCount,
        totalSensors: sensorsToEnable.length,
        results,
        note: enabledCount < sensorsToEnable.length
            ? 'Some sensors may need manual enable in HA UI. REST API has limited support for entity registry.'
            : 'All sensors enabled'
    };
}

/**
 * Store pending request in KV (or in-memory for testing)
 * PENDING_TTL_SECONDS: 5 minutes - when web shows "expired, can retry"
 * KV TTL: 1 hour - actual storage time (gives admin more time to respond)
 */
const PENDING_TTL_SECONDS = 300; // 5 minutes for client-side expired check
const KV_STORAGE_TTL = 3600; // 1 hour for actual KV storage

async function storePendingRequest(env, deviceId, requestData) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `pending_${normalizedId}`;
    const data = {
        deviceId: normalizedId,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString(),
        ...requestData
    };

    if (env?.DEVICE_REQUESTS) {
        // Use KV storage with 1 hour TTL (longer than client-side check)
        await env.DEVICE_REQUESTS.put(key, JSON.stringify(data), {
            expirationTtl: KV_STORAGE_TTL
        });
    } else {
        // Fallback to in-memory (not persistent across workers)
        pendingRequests.set(key, data);
    }

    return data;
}

/**
 * Get pending request from KV
 * Also checks if request has expired (> 5 minutes)
 */
async function getPendingRequest(env, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `pending_${normalizedId}`;

    let data = null;
    if (env?.DEVICE_REQUESTS) {
        const raw = await env.DEVICE_REQUESTS.get(key);
        data = raw ? JSON.parse(raw) : null;
    } else {
        data = pendingRequests.get(key) || null;
    }

    // Check if expired (for in-memory fallback or if KV hasn't auto-deleted yet)
    if (data && data.requestedAt) {
        const requestedTime = new Date(data.requestedAt).getTime();
        const now = Date.now();
        const elapsedSeconds = (now - requestedTime) / 1000;

        if (elapsedSeconds > PENDING_TTL_SECONDS) {
            // Mark as expired
            data.status = 'expired';
            data.expiredReason = 'Timeout after 5 minutes - admin did not respond';
        }
    }

    return data;
}

/**
 * Update pending request status
 */
async function updatePendingRequest(env, deviceId, status, additionalData = {}) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `pending_${normalizedId}`;

    const existing = await getPendingRequest(env, deviceId);
    if (!existing) return null;

    const updated = {
        ...existing,
        status: status,
        processedAt: new Date().toISOString(),
        ...additionalData
    };

    if (env?.DEVICE_REQUESTS) {
        await env.DEVICE_REQUESTS.put(key, JSON.stringify(updated), {
            expirationTtl: 86400
        });
    } else {
        pendingRequests.set(key, updated);
    }

    return updated;
}

/**
 * Store approval history for web to fetch
 */
async function storeApprovalHistory(env, deviceId, approvalData) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `approval_${normalizedId}`;
    const data = {
        deviceId: normalizedId,
        ...approvalData,
        timestamp: new Date().toISOString()
    };

    if (env?.DEVICE_REQUESTS) {
        await env.DEVICE_REQUESTS.put(key, JSON.stringify(data), {
            expirationTtl: 3600 // 1 hour
        });
    } else {
        approvalHistory.set(key, data);
    }

    return data;
}

/**
 * Get approval history
 */
async function getApprovalHistory(env, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `approval_${normalizedId}`;

    if (env?.DEVICE_REQUESTS) {
        const data = await env.DEVICE_REQUESTS.get(key);
        return data ? JSON.parse(data) : null;
    } else {
        return approvalHistory.get(key) || null;
    }
}

/**
 * Delete pending request
 */
async function deletePendingRequest(env, deviceId) {
    const normalizedId = normalizeDeviceId(deviceId);
    const key = `pending_${normalizedId}`;

    if (env?.DEVICE_REQUESTS) {
        await env.DEVICE_REQUESTS.delete(key);
    } else {
        pendingRequests.delete(key);
    }
}

/**
 * List all pending requests
 */
async function listPendingRequests(env) {
    if (env?.DEVICE_REQUESTS) {
        const list = await env.DEVICE_REQUESTS.list({ prefix: 'pending_' });
        const requests = [];
        for (const key of list.keys) {
            const data = await env.DEVICE_REQUESTS.get(key.name);
            if (data) {
                requests.push(JSON.parse(data));
            }
        }
        return requests;
    } else {
        return Array.from(pendingRequests.values()).filter(r => r.status === 'pending');
    }
}

/**
 * Main request handler
 */

// Security: Allowed origins and secret key
const ALLOWED_ORIGINS = [
    'https://lumentree.pages.dev',
    'https://lumentree-beta.pages.dev'
];
const SECRET_KEY = 'lumentree123';

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
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        // Auto-fix URL: replace second ? with & (e.g., ?deviceId=...?secret=... → ?deviceId=...&secret=...)
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

        // Check HA configuration
        const haUrl = env?.HA_URL;
        const haToken = env?.HA_TOKEN;
        const adminChatId = env?.TELEGRAM_ADMIN_CHAT_ID;

        // Health check (always allowed)
        if (path === '/health' || path === '/') {
            // Continue to health check below
        }
        // Telegram webhook - skip auth (uses Telegram's own security)
        else if (path === '/telegram-webhook') {
            // Continue to webhook handler below
        }
        // All other endpoints require authorization
        else if (!isAuthorized(request, url)) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Unauthorized',
                message: 'Access denied. Invalid origin or missing secret key.',
                version: '5.0'
            }), { status: 403, headers: CORS_HEADERS });
        }

        // ==================== HEALTH CHECK ====================
        if (path === '/health' || path === '/') {
            return new Response(JSON.stringify({
                status: 'ok',
                version: '5.0',
                protection: 'origin + secret key',
                service: 'Device Registration Worker with Telegram Approval + Web Sync + Auto-Enable PV',
                haConfigured: !!(haUrl && haToken),
                telegramConfigured: !!adminChatId,
                features: [
                    '🔒 Origin protection (lumentree.pages.dev only)',
                    '🔔 Telegram Approval Flow - notify admin before registering',
                    '✅ Accept/Reject buttons on Telegram',
                    '🛡️ Prevents crash by requiring approval',
                    '📋 Pending requests management',
                    '🔄 Auto-add to HA when approved',
                    '🌐 Real-time Web UI status update',
                    '✨ Web shows tick when approved via Telegram',
                    '🔌 Auto-enable PV sensors (PV1, PV2, PV1 Power, PV2 Power)'
                ],
                endpoints: [
                    'GET /health',
                    'GET /check/:deviceId - includes approvedBy info',
                    'GET /pending-requests',
                    'POST /request-device - Submit new device (triggers Telegram)',
                    'POST /approve/:deviceId - Approve device',
                    'POST /reject/:deviceId - Reject device',
                    'POST /telegram-webhook - Telegram callback handler',
                    'GET /config-entries',
                    'POST /register-integration - Direct register',
                    'POST /remove-entry'
                ],
                telegramBot: 'https://t.me/lumentreecall_bot'
            }), { headers: CORS_HEADERS });
        }

        // ==================== TELEGRAM WEBHOOK ====================
        if (path === '/telegram-webhook' && request.method === 'POST') {
            try {
                const update = await request.json();
                console.log('[Telegram Webhook] Received update:', JSON.stringify(update));

                // Handle callback query (button clicks)
                if (update.callback_query) {
                    const callbackQuery = update.callback_query;
                    const callbackData = callbackQuery.data;
                    const chatId = callbackQuery.message?.chat?.id;
                    const messageId = callbackQuery.message?.message_id;
                    const fromUser = callbackQuery.from?.first_name || 'Admin';

                    // Parse callback data
                    if (callbackData.startsWith('approve_')) {
                        const deviceId = callbackData.replace('approve_', '');

                        // Update pending request
                        await updatePendingRequest(env, deviceId, 'approved', { approvedBy: fromUser });

                        // Check if already in HA
                        const existing = await checkDeviceInLumentreeIntegration(haUrl, haToken, deviceId);

                        let resultMessage;
                        let registrationSuccess = false;
                        let enableInfo = '';

                        if (existing.exists) {
                            resultMessage = `✅ *APPROVED* - Device ${deviceId}\n\n⚠️ Device đã có trong HA với state: ${existing.state}`;
                            registrationSuccess = true;
                        } else if (haUrl && haToken) {
                            // Register to HA
                            const registerResult = await registerDeviceToLumentreeIntegration(haUrl, haToken, deviceId);
                            if (registerResult.success) {
                                // v4.6: Auto-enable PV sensors after registration
                                const enableResult = await enableDefaultPVSensors(haUrl, haToken, deviceId);
                                if (enableResult.enabledCount > 0) {
                                    enableInfo = `\n🔌 Auto-enabled ${enableResult.enabledCount}/${enableResult.totalSensors} PV sensors`;
                                }

                                resultMessage = `✅ *APPROVED & REGISTERED*\n\n📱 Device: \`${deviceId}\`\n✅ Đã thêm vào Home Assistant${enableInfo}\n👤 Approved by: ${fromUser}`;
                                registrationSuccess = true;
                            } else {
                                resultMessage = `✅ *APPROVED* nhưng ❌ *REGISTRATION FAILED*\n\n📱 Device: \`${deviceId}\`\n❌ Lỗi: ${registerResult.error}\n👤 Approved by: ${fromUser}`;
                            }
                        } else {
                            resultMessage = `✅ *APPROVED*\n\n📱 Device: \`${deviceId}\`\n⚠️ HA not configured - cannot auto-register\n👤 Approved by: ${fromUser}`;
                        }

                        // Store approval history for web to fetch
                        await storeApprovalHistory(env, deviceId, {
                            status: 'approved',
                            approvedBy: fromUser,
                            registered: registrationSuccess
                        });

                        await editTelegramMessage(chatId, messageId, resultMessage);
                        await answerCallbackQuery(callbackQuery.id, `Device ${deviceId} approved!`);

                        // Clean up pending request
                        await deletePendingRequest(env, deviceId);
                    }
                    else if (callbackData.startsWith('reject_')) {
                        const deviceId = callbackData.replace('reject_', '');

                        // Update pending request
                        await updatePendingRequest(env, deviceId, 'rejected', { rejectedBy: fromUser });

                        // Store rejection history for web to fetch
                        await storeApprovalHistory(env, deviceId, {
                            status: 'rejected',
                            rejectedBy: fromUser
                        });

                        const resultMessage = `❌ *REJECTED*\n\n📱 Device: \`${deviceId}\`\n🚫 KHÔNG được thêm vào Home Assistant\n👤 Rejected by: ${fromUser}`;

                        await editTelegramMessage(chatId, messageId, resultMessage);
                        await answerCallbackQuery(callbackQuery.id, `Device ${deviceId} rejected!`);

                        // Clean up
                        await deletePendingRequest(env, deviceId);
                    }
                    else if (callbackData.startsWith('check_')) {
                        const deviceId = callbackData.replace('check_', '');

                        // Check device status
                        let checkResult = 'Checking...';
                        if (haUrl && haToken) {
                            const [integrationCheck, dataCheck] = await Promise.all([
                                checkDeviceInLumentreeIntegration(haUrl, haToken, deviceId),
                                checkDeviceHasData(haUrl, haToken, deviceId)
                            ]);

                            checkResult = `🔍 *CHECK RESULT*

📱 Device: \`${deviceId}\`
📍 In Integration: ${integrationCheck.exists ? '✅ YES' : '❌ NO'}
${integrationCheck.exists ? `📊 State: ${integrationCheck.state}` : ''}
📈 Has Data: ${dataCheck.hasData ? '✅ YES' : '❌ NO'}
📝 Entity Count: ${dataCheck.entityCount || 0}
📊 Entities with Data: ${dataCheck.entitiesWithData || 0}`;
                        } else {
                            checkResult = '⚠️ HA not configured - cannot check device';
                        }

                        await answerCallbackQuery(callbackQuery.id, checkResult, true);
                    }

                    return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
                }

                // Handle regular messages (commands)
                if (update.message?.text) {
                    const text = update.message.text;
                    const chatId = update.message.chat.id;

                    if (text === '/start' || text === '/help') {
                        await fetch(`${TELEGRAM_API}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: chatId,
                                text: `🤖 *Lumentree Device Registration Bot v4.6*

Tôi sẽ thông báo cho bạn khi có yêu cầu thêm thiết bị mới.

*Commands:*
/pending - Xem danh sách đang chờ duyệt
/check [deviceId] - Kiểm tra trạng thái thiết bị

*v4.6 Features:*
🔌 Auto-enable PV sensors sau khi register

*Chat ID của bạn:* \`${chatId}\`
(Sử dụng ID này để cấu hình TELEGRAM_ADMIN_CHAT_ID)`,
                                parse_mode: 'Markdown'
                            })
                        });
                    }
                    else if (text === '/pending') {
                        const pending = await listPendingRequests(env);
                        const pendingText = pending.length > 0
                            ? pending.map(p => `• ${p.deviceId} - ${p.requestedAt}`).join('\n')
                            : 'Không có yêu cầu nào đang chờ';

                        await fetch(`${TELEGRAM_API}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: chatId,
                                text: `📋 *Pending Requests:*\n\n${pendingText}`,
                                parse_mode: 'Markdown'
                            })
                        });
                    }
                    else if (text.startsWith('/check ')) {
                        const deviceId = text.replace('/check ', '').trim();
                        if (haUrl && haToken) {
                            const [integrationCheck, dataCheck] = await Promise.all([
                                checkDeviceInLumentreeIntegration(haUrl, haToken, deviceId),
                                checkDeviceHasData(haUrl, haToken, deviceId)
                            ]);

                            await fetch(`${TELEGRAM_API}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: chatId,
                                    text: `🔍 *Device Check: ${deviceId}*

📍 In Integration: ${integrationCheck.exists ? '✅ YES' : '❌ NO'}
${integrationCheck.exists ? `📊 State: ${integrationCheck.state}` : ''}
📈 Has Data: ${dataCheck.hasData ? '✅ YES' : '❌ NO'}
📝 Entities: ${dataCheck.entityCount || 0}`,
                                    parse_mode: 'Markdown'
                                })
                            });
                        }
                    }
                }

                return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
            } catch (error) {
                console.error('[Telegram Webhook] Error:', error);
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500, headers: CORS_HEADERS
                });
            }
        }

        // ==================== REQUEST DEVICE (Main endpoint) ====================
        if (path === '/request-device' && request.method === 'POST') {
            try {
                const body = await request.json();
                const deviceId = body.deviceId;
                const source = body.source || 'API';
                const userInfo = body.userInfo || '';

                if (!deviceId) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Missing deviceId'
                    }), { status: 400, headers: CORS_HEADERS });
                }

                const normalizedId = normalizeDeviceId(deviceId);

                // Validate format
                if (!validateDeviceIdFormat(normalizedId)) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Invalid device ID format: ${normalizedId}`,
                        hint: 'Format: P/H + 9 digits (e.g., P250714718)'
                    }), { status: 400, headers: CORS_HEADERS });
                }

                // Check if already in HA
                if (haUrl && haToken) {
                    const existing = await checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId);
                    if (existing.exists) {
                        return new Response(JSON.stringify({
                            success: true,
                            status: 'already_exists',
                            message: `Device ${normalizedId} already in Home Assistant`,
                            state: existing.state,
                            requiresApproval: false
                        }), { headers: CORS_HEADERS });
                    }
                }

                // Check if already pending (but allow retry if expired)
                const existingRequest = await getPendingRequest(env, normalizedId);
                if (existingRequest) {
                    if (existingRequest.status === 'pending') {
                        // Still pending - don't allow duplicate
                        return new Response(JSON.stringify({
                            success: true,
                            status: 'pending',
                            message: `Device ${normalizedId} already pending approval`,
                            requestedAt: existingRequest.requestedAt,
                            expiresAt: existingRequest.expiresAt
                        }), { headers: CORS_HEADERS });
                    } else if (existingRequest.status === 'expired') {
                        // Expired - delete old request and allow retry
                        await deletePendingRequest(env, normalizedId);
                        console.log(`[Request] Deleted expired request for ${normalizedId}, allowing retry`);
                    }
                }

                // Store pending request
                const requestData = await storePendingRequest(env, normalizedId, {
                    source,
                    userInfo
                });

                // Send Telegram notification
                let telegramResult = { ok: false, reason: 'not_configured' };
                if (adminChatId) {
                    telegramResult = await sendTelegramNotification(adminChatId, normalizedId, {
                        source,
                        userInfo
                    });
                } else {
                    // Try to get admin chat ID dynamically
                    const dynamicChatId = await getTelegramAdminChatId(env);
                    if (dynamicChatId) {
                        telegramResult = await sendTelegramNotification(dynamicChatId, normalizedId, {
                            source,
                            userInfo
                        });
                    }
                }

                return new Response(JSON.stringify({
                    success: true,
                    status: 'pending_approval',
                    message: `Device ${normalizedId} submitted for approval`,
                    deviceId: normalizedId,
                    telegramSent: telegramResult.ok,
                    requestedAt: requestData.requestedAt,
                    nextStep: 'Wait for admin to approve on Telegram'
                }), { headers: CORS_HEADERS });

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: CORS_HEADERS });
            }
        }

        // ==================== APPROVE DEVICE ====================
        const approveMatch = path.match(/^\/approve\/([^/]+)$/);
        if (approveMatch && request.method === 'POST') {
            const deviceId = approveMatch[1];
            const normalizedId = normalizeDeviceId(deviceId);

            try {
                // Check if already in HA
                if (haUrl && haToken) {
                    const existing = await checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId);
                    if (existing.exists) {
                        // Store approval history
                        await storeApprovalHistory(env, normalizedId, {
                            status: 'approved',
                            approvedBy: 'API',
                            registered: true
                        });

                        return new Response(JSON.stringify({
                            success: true,
                            status: 'already_exists',
                            message: `Device ${normalizedId} already in Home Assistant`,
                            state: existing.state
                        }), { headers: CORS_HEADERS });
                    }

                    // Register to HA
                    const registerResult = await registerDeviceToLumentreeIntegration(haUrl, haToken, normalizedId);

                    // v4.6: Auto-enable PV sensors after registration
                    let enableResult = null;
                    if (registerResult.success) {
                        enableResult = await enableDefaultPVSensors(haUrl, haToken, normalizedId);
                    }

                    // Store approval history
                    await storeApprovalHistory(env, normalizedId, {
                        status: 'approved',
                        approvedBy: 'API',
                        registered: registerResult.success,
                        sensorsEnabled: enableResult?.enabledCount || 0
                    });

                    // Update pending request
                    await updatePendingRequest(env, normalizedId, 'approved', {
                        registerResult: registerResult.success
                    });

                    // Clean up
                    await deletePendingRequest(env, normalizedId);

                    return new Response(JSON.stringify({
                        success: registerResult.success,
                        status: registerResult.success ? 'approved_and_registered' : 'approved_but_failed',
                        message: registerResult.success
                            ? `Device ${normalizedId} approved and registered to HA`
                            : `Device ${normalizedId} approved but registration failed`,
                        registerResult,
                        sensorsEnabled: enableResult
                    }), { headers: CORS_HEADERS });
                }

                return new Response(JSON.stringify({
                    success: false,
                    error: 'Home Assistant not configured'
                }), { status: 500, headers: CORS_HEADERS });

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: CORS_HEADERS });
            }
        }

        // ==================== REJECT DEVICE ====================
        const rejectMatch = path.match(/^\/reject\/([^/]+)$/);
        if (rejectMatch && request.method === 'POST') {
            const deviceId = rejectMatch[1];
            const normalizedId = normalizeDeviceId(deviceId);

            // Store rejection history
            await storeApprovalHistory(env, normalizedId, {
                status: 'rejected',
                rejectedBy: 'API'
            });

            await updatePendingRequest(env, normalizedId, 'rejected');
            await deletePendingRequest(env, normalizedId);

            return new Response(JSON.stringify({
                success: true,
                status: 'rejected',
                message: `Device ${normalizedId} rejected - will NOT be added to HA`,
                deviceId: normalizedId
            }), { headers: CORS_HEADERS });
        }

        // ==================== GET PENDING REQUESTS ====================
        if (path === '/pending-requests' && request.method === 'GET') {
            const pending = await listPendingRequests(env);
            return new Response(JSON.stringify({
                count: pending.length,
                requests: pending
            }), { headers: CORS_HEADERS });
        }

        // ==================== CHECK DEVICE (Enhanced with approval info) ====================
        const checkMatch = path.match(/^\/check\/([^/]+)$/);
        if (checkMatch && request.method === 'GET') {
            const deviceId = checkMatch[1];
            const normalizedId = normalizeDeviceId(deviceId);

            if (!haUrl || !haToken) {
                return new Response(JSON.stringify({
                    error: 'Home Assistant not configured'
                }), { status: 500, headers: CORS_HEADERS });
            }

            const [integrationCheck, dataCheck] = await Promise.all([
                checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId),
                checkDeviceHasData(haUrl, haToken, normalizedId)
            ]);

            // Check pending status
            const pendingRequest = await getPendingRequest(env, normalizedId);

            // Check approval history
            const approvalInfo = await getApprovalHistory(env, normalizedId);

            // Calculate remaining time for pending requests
            let remainingSeconds = null;
            if (pendingRequest && pendingRequest.status === 'pending' && pendingRequest.requestedAt) {
                const requestedTime = new Date(pendingRequest.requestedAt).getTime();
                const elapsed = (Date.now() - requestedTime) / 1000;
                remainingSeconds = Math.max(0, PENDING_TTL_SECONDS - elapsed);
            }

            // Determine recommendation based on status
            let recommendation = 'Device not in HA - use /request-device to submit for approval';
            if (integrationCheck.exists) {
                recommendation = 'Device already in HA - OK';
            } else if (approvalInfo?.status === 'rejected') {
                // Check rejection first (from approvalHistory)
                recommendation = 'Device was REJECTED by admin - you can retry after some time';
            } else if (approvalInfo?.status === 'approved') {
                recommendation = 'Device was approved - waiting for HA sync';
            } else if (pendingRequest?.status === 'pending') {
                recommendation = `Waiting for admin approval (${Math.round(remainingSeconds)}s remaining)`;
            } else if (pendingRequest?.status === 'expired') {
                recommendation = 'Request expired - you can retry now';
            }

            return new Response(JSON.stringify({
                deviceId: normalizedId,
                formatValid: validateDeviceIdFormat(normalizedId),
                inIntegration: integrationCheck.exists,
                integrationState: integrationCheck.state,
                hasData: dataCheck.hasData,
                entityCount: dataCheck.entityCount,
                entitiesWithData: dataCheck.entitiesWithData,
                pendingStatus: pendingRequest?.status || null,
                // Timing info for web UI
                requestedAt: pendingRequest?.requestedAt || null,
                expiresAt: pendingRequest?.expiresAt || null,
                remainingSeconds: remainingSeconds,
                expiredReason: pendingRequest?.expiredReason || null,
                canRetry: pendingRequest?.status === 'expired' || approvalInfo?.status === 'rejected' || (!pendingRequest && !approvalInfo),
                // Approval info for web UI
                approvalStatus: approvalInfo?.status || null,  // 'approved' | 'rejected' | null
                approvalInfo: approvalInfo || null,
                approvedBy: approvalInfo?.approvedBy || null,
                approvedAt: approvalInfo?.timestamp || null,
                rejectedBy: approvalInfo?.rejectedBy || null,
                recommendation
            }), { headers: CORS_HEADERS });
        }

        // ==================== CONFIG ENTRIES ====================
        if (path === '/config-entries' && request.method === 'GET') {
            if (!haUrl || !haToken) {
                return new Response(JSON.stringify({
                    error: 'Home Assistant not configured'
                }), { status: 500, headers: CORS_HEADERS });
            }

            const entries = await getLumentreeConfigEntries(haUrl, haToken);
            return new Response(JSON.stringify({
                count: entries.length,
                entries: entries.map(e => ({
                    entryId: e.entry_id,
                    title: e.title,
                    state: e.state
                }))
            }), { headers: CORS_HEADERS });
        }

        // ==================== DIRECT REGISTER ====================
        if (path === '/register-integration' && request.method === 'POST') {
            if (!haUrl || !haToken) {
                return new Response(JSON.stringify({
                    error: 'Home Assistant not configured'
                }), { status: 500, headers: CORS_HEADERS });
            }

            try {
                const body = await request.json();
                const deviceId = body.deviceId;

                if (!deviceId) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Missing deviceId'
                    }), { status: 400, headers: CORS_HEADERS });
                }

                const normalizedId = normalizeDeviceId(deviceId);

                // Check if already registered
                const existing = await checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId);
                if (existing.exists) {
                    return new Response(JSON.stringify({
                        success: true,
                        alreadyExists: true,
                        message: `Device ${normalizedId} already in Lumentree Integration`,
                        state: existing.state
                    }), { headers: CORS_HEADERS });
                }

                const result = await registerDeviceToLumentreeIntegration(haUrl, haToken, normalizedId);

                // v4.6: Auto-enable PV sensors after registration
                let enableResult = null;
                if (result.success) {
                    enableResult = await enableDefaultPVSensors(haUrl, haToken, normalizedId);
                }

                return new Response(JSON.stringify({
                    ...result,
                    deviceId: normalizedId,
                    sensorsEnabled: enableResult
                }), {
                    status: result.success ? 200 : 400,
                    headers: CORS_HEADERS
                });

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: CORS_HEADERS });
            }
        }

        // ==================== REMOVE ENTRY ====================
        if (path === '/remove-entry' && request.method === 'POST') {
            if (!haUrl || !haToken) {
                return new Response(JSON.stringify({
                    error: 'Home Assistant not configured'
                }), { status: 500, headers: CORS_HEADERS });
            }

            try {
                const body = await request.json();
                const deviceId = body.deviceId;

                if (!deviceId) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: 'Missing deviceId'
                    }), { status: 400, headers: CORS_HEADERS });
                }

                const normalizedId = normalizeDeviceId(deviceId);

                // Find config entry for this device
                const entries = await getLumentreeConfigEntries(haUrl, haToken);
                const deviceEntry = entries.find(e =>
                    e.title.toUpperCase().includes(normalizedId) ||
                    e.data?.device_id?.toUpperCase() === normalizedId
                );

                if (!deviceEntry) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: `No config entry found for device ${normalizedId}`
                    }), { status: 404, headers: CORS_HEADERS });
                }

                // Remove config entry
                const removeResponse = await fetch(`${haUrl}/api/config/config_entries/entry/${deviceEntry.entry_id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${haToken}` }
                });

                if (removeResponse.ok) {
                    return new Response(JSON.stringify({
                        success: true,
                        message: `Device ${normalizedId} removed from Lumentree Integration`,
                        entryId: deviceEntry.entry_id
                    }), { headers: CORS_HEADERS });
                } else {
                    const error = await removeResponse.text();
                    return new Response(JSON.stringify({
                        success: false,
                        error: `Failed to remove: ${error}`
                    }), { status: removeResponse.status, headers: CORS_HEADERS });
                }

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: error.message
                }), { status: 500, headers: CORS_HEADERS });
            }
        }

        // ==================== 404 ====================
        return new Response(JSON.stringify({
            error: 'Not found',
            path: path,
            availableEndpoints: [
                'GET /health',
                'GET /check/:deviceId',
                'GET /pending-requests',
                'POST /request-device',
                'POST /approve/:deviceId',
                'POST /reject/:deviceId',
                'POST /telegram-webhook',
                'GET /config-entries',
                'POST /register-integration',
                'POST /remove-entry'
            ]
        }), { status: 404, headers: CORS_HEADERS });
    }
};
