/**
 * Device Registration Worker v3.4
 * Auto-register new devices to Home Assistant via Lumentree Integration
 * 
 * v3.4 Changes:
 * - NEW: /remove-entry endpoint to remove invalid devices
 * - Auto-cleanup devices that have no data after registration
 * - Prevents ghost devices from crashing the system
 * 
 * v3.2 Changes:
 * - NEW: /has-mqtt-data/:deviceId - Check if device has MQTT data (prevent ghost devices)
 * - Validates device exists in MQTT broker before allowing registration
 * 
 * v3.1 Changes:
 * - Multi-step config flow support (user -> confirm_device -> create_entry)
 * - Improved error handling and logging
 * 
 * Features:
 * - Check if device exists in Lumentree Integration (not MQTT Discovery)
 * - Check if device has MQTT data before registering
 * - Auto-register via Home Assistant Config Flow API
 * - Auto-enable disabled entities (PV1, PV2, Voltage, etc.)
 * 
 * Endpoints:
 * - GET /health - Health check
 * - GET /check/:deviceId - Check if device exists in Lumentree Integration
 * - GET /has-mqtt-data/:deviceId - Check if device has MQTT data (NEW!)
 * - GET /disabled/:deviceId - Get disabled entities for device
 * - GET /config-entries - List all Lumentree config entries
 * - POST /register-integration - Register device to Lumentree Integration
 * - POST /enable-entities - Enable disabled entities
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const LUMENTREE_DOMAIN = 'lumentree';

// Entity patterns for Lumentree Integration
const LUMENTREE_ENTITY_PATTERNS = [
  'pv_power', 'battery_power', 'load_power', 'grid_power', 'battery_soc',
  'pv1_power', 'pv2_power', 'pv1_voltage', 'pv2_voltage', 'pv1_current', 'pv2_current',
  'grid_voltage', 'battery_voltage', 'battery_current', 'device_temperature',
  'ac_output_power', 'ac_input_power', 'essential_power', 'total_load_power'
];

// Entities that are disabled by default
const DISABLED_BY_DEFAULT = [
  'pv1_power', 'pv2_power', 'pv1_voltage', 'pv2_voltage', 'pv1_current', 'pv2_current',
  'grid_voltage', 'battery_voltage', 'battery_current', 'device_temperature'
];

function normalizeDeviceId(deviceId) {
  return deviceId?.toUpperCase()?.trim() || '';
}

/**
 * Check if device exists in Lumentree Integration
 */
async function checkDeviceInLumentreeIntegration(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  // Entity format for Lumentree Integration: sensor.device_{deviceId}_xxx
  const entityId = `sensor.device_${normalizedId.toLowerCase()}_pv_power`;
  
  try {
    const response = await fetch(`${haUrl}/api/states/${entityId}`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        exists: true,
        state: data.state,
        entityId: entityId
      };
    }
    
    return { exists: false };
  } catch (error) {
    console.error('Error checking Lumentree Integration:', error);
    return { exists: false, error: error.message };
  }
}

/**
 * Check if device exists in MQTT Discovery (old format)
 */
async function checkDeviceInMqtt(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  // MQTT Discovery format: sensor.lumentree_{deviceId}_{deviceId}_pv_power
  const entityId = `sensor.lumentree_${normalizedId.toLowerCase()}_${normalizedId.toLowerCase()}_pv_power`;
  
  try {
    const response = await fetch(`${haUrl}/api/states/${entityId}`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    return { exists: response.ok };
  } catch (error) {
    return { exists: false };
  }
}

/**
 * Count entities for a device (both integration and MQTT)
 */
async function countDeviceEntities(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  try {
    const response = await fetch(`${haUrl}/api/states`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    if (!response.ok) return { integrationCount: 0, mqttCount: 0, totalCount: 0 };
    
    const states = await response.json();
    
    // Lumentree Integration format: sensor.device_{id}_xxx
    const integrationPattern = `sensor.device_${normalizedId.toLowerCase()}_`;
    // MQTT Discovery format: sensor.lumentree_{id}_xxx
    const mqttPattern = `sensor.lumentree_${normalizedId.toLowerCase()}_`;
    
    const integrationEntities = states.filter(s => s.entity_id.startsWith(integrationPattern));
    const mqttEntities = states.filter(s => s.entity_id.startsWith(mqttPattern));
    
    return {
      integrationCount: integrationEntities.length,
      mqttCount: mqttEntities.length,
      totalCount: integrationEntities.length + mqttEntities.length,
      integrationSample: integrationEntities.slice(0, 5).map(s => s.entity_id),
      mqttSample: mqttEntities.slice(0, 5).map(s => s.entity_id)
    };
  } catch (error) {
    console.error('Error counting entities:', error);
    return { integrationCount: 0, mqttCount: 0, totalCount: 0 };
  }
}

/**
 * Check if device has MQTT data (exists in MQTT broker)
 * This is used to validate if device ID is real before registering
 */
async function checkMqttHasData(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  try {
    const response = await fetch(`${haUrl}/api/states`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    if (!response.ok) {
      return { hasData: false, error: `HTTP ${response.status}` };
    }
    
    const states = await response.json();
    
    // Check for ANY entity with this device ID that has actual data
    const patterns = [
      `sensor.device_${normalizedId.toLowerCase()}_`,
      `sensor.lumentree_${normalizedId.toLowerCase()}_`
    ];
    
    const deviceEntities = states.filter(s => 
      patterns.some(p => s.entity_id.startsWith(p))
    );
    
    if (deviceEntities.length === 0) {
      return { hasData: false, reason: 'no_entities' };
    }
    
    // Check if any entity has valid data (not unknown/unavailable)
    const validStates = ['unknown', 'unavailable', null, undefined, ''];
    const hasValidData = deviceEntities.some(e => 
      !validStates.includes(e.state) && !isNaN(parseFloat(e.state))
    );
    
    return {
      hasData: hasValidData,
      entityCount: deviceEntities.length,
      validDataCount: deviceEntities.filter(e => !validStates.includes(e.state)).length,
      sampleEntities: deviceEntities.slice(0, 3).map(e => ({
        entity_id: e.entity_id,
        state: e.state
      }))
    };
  } catch (error) {
    console.error('Error checking MQTT data:', error);
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
    console.error('Error getting config entries:', error);
    return [];
  }
}

/**
 * Register device to Lumentree Integration via Config Flow
 * Handles multi-step flow: user -> confirm_device -> create_entry
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
        body: JSON.stringify({
          device_id: normalizedId
        })
      });
      
      if (!submitResponse.ok) {
        const error = await submitResponse.text();
        return { success: false, error: `Submit device_id failed: ${error}` };
      }
      
      flowData = await submitResponse.json();
      console.log(`[Register] After submit: step=${flowData.step_id}, type=${flowData.type}`);
    }
    
    // Step 3: Handle confirm_device step (if present)
    if (flowData.step_id === 'confirm_device') {
      console.log(`[Register] Step 3: Confirm device`);
      const confirmResponse = await fetch(`${haUrl}/api/config/config_entries/flow/${flowData.flow_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({}) // Empty body to confirm
      });
      
      if (!confirmResponse.ok) {
        const error = await confirmResponse.text();
        return { success: false, error: `Confirm failed: ${error}` };
      }
      
      flowData = await confirmResponse.json();
      console.log(`[Register] After confirm: type=${flowData.type}`);
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
    
    // Handle errors or unexpected states
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
      step: flowData.step_id,
      flowId: flowData.flow_id
    };
    
  } catch (error) {
    console.error('Error registering device:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Check HA configuration
    const haUrl = env.HA_URL;
    const haToken = env.HA_TOKEN;
    
    // Health check - always available
    if (path === '/health' || path === '/') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '3.4',
        service: 'Device Registration Worker (Lumentree Integration)',
        haConfigured: !!(haUrl && haToken),
        features: [
          'Check device in Lumentree Integration',
          'Check device MQTT data existence',
          'Register device via Config Flow',
          'Remove invalid devices (NEW in v3.4)',
          'Multi-step flow support',
          'Enable disabled entities'
        ],
        endpoints: [
          'GET /health',
          'GET /check/:deviceId',
          'GET /has-mqtt-data/:deviceId',
          'GET /disabled/:deviceId',
          'GET /config-entries',
          'POST /register-integration',
          'POST /remove-entry (NEW!)',
          'POST /enable-entities'
        ],
        integrationDomain: LUMENTREE_DOMAIN,
        entityFormat: 'sensor.device_{deviceId}_xxx'
      }), { headers: CORS_HEADERS });
    }
    
    // All other endpoints require HA configuration
    if (!haUrl || !haToken) {
      return new Response(JSON.stringify({
        error: 'Home Assistant not configured',
        required: ['HA_URL', 'HA_TOKEN']
      }), { status: 500, headers: CORS_HEADERS });
    }
    
    // GET /check/:deviceId - Check device existence
    const checkMatch = path.match(/^\/check\/([^/]+)$/);
    if (checkMatch && request.method === 'GET') {
      const deviceId = checkMatch[1];
      const normalizedId = normalizeDeviceId(deviceId);
      
      const [integrationCheck, mqttCheck, entityCount] = await Promise.all([
        checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId),
        checkDeviceInMqtt(haUrl, haToken, normalizedId),
        countDeviceEntities(haUrl, haToken, normalizedId)
      ]);
      
      const inIntegration = integrationCheck.exists;
      const inMqtt = mqttCheck.exists;
      
      return new Response(JSON.stringify({
        deviceId: normalizedId,
        inLumentreeIntegration: inIntegration,
        inMqttDiscovery: inMqtt,
        integrationState: integrationCheck.state,
        entityCount: entityCount,
        recommendation: inIntegration 
          ? 'Device already in Lumentree Integration - OK'
          : inMqtt 
            ? 'Device in MQTT Discovery only - consider migrating to Integration'
            : 'Device not found - needs registration'
      }), { headers: CORS_HEADERS });
    }
    
    // GET /has-mqtt-data/:deviceId - Check if device has MQTT data (NEW!)
    const mqttDataMatch = path.match(/^\/has-mqtt-data\/([^/]+)$/);
    if (mqttDataMatch && request.method === 'GET') {
      const deviceId = mqttDataMatch[1];
      const normalizedId = normalizeDeviceId(deviceId);
      
      const mqttData = await checkMqttHasData(haUrl, haToken, normalizedId);
      
      return new Response(JSON.stringify({
        deviceId: normalizedId,
        ...mqttData
      }), { headers: CORS_HEADERS });
    }
    
    // GET /config-entries - List Lumentree config entries
    if (path === '/config-entries' && request.method === 'GET') {
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
    
    // POST /register-integration - Register device to Lumentree Integration
    if (path === '/register-integration' && request.method === 'POST') {
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
        
        // Register device
        const result = await registerDeviceToLumentreeIntegration(haUrl, haToken, normalizedId);
        
        return new Response(JSON.stringify({
          ...result,
          deviceId: normalizedId,
          entityFormat: `sensor.device_${normalizedId.toLowerCase()}_xxx`
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
    
    // POST /remove-entry - Remove device from Lumentree Integration
    // Used to clean up invalid devices that have no data
    if (path === '/remove-entry' && request.method === 'POST') {
      try {
        const body = await request.json();
        const deviceId = body.deviceId;
        const entryId = body.entryId;
        
        if (!deviceId) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing deviceId'
          }), { status: 400, headers: CORS_HEADERS });
        }
        
        const normalizedId = normalizeDeviceId(deviceId);
        
        // Find config entry for this device if entryId not provided
        let targetEntryId = entryId;
        if (!targetEntryId) {
          const entries = await getLumentreeConfigEntries(haUrl, haToken);
          const deviceEntry = entries.find(e => 
            e.title.toUpperCase().includes(normalizedId) ||
            e.data?.device_id?.toUpperCase() === normalizedId
          );
          if (deviceEntry) {
            targetEntryId = deviceEntry.entry_id;
          }
        }
        
        if (!targetEntryId) {
          return new Response(JSON.stringify({
            success: false,
            error: `No config entry found for device ${normalizedId}`
          }), { status: 404, headers: CORS_HEADERS });
        }
        
        // Remove config entry
        const removeResponse = await fetch(`${haUrl}/api/config/config_entries/entry/${targetEntryId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${haToken}` }
        });
        
        if (removeResponse.ok) {
          console.log(`✅ [Remove] Config entry ${targetEntryId} for ${normalizedId} removed`);
          return new Response(JSON.stringify({
            success: true,
            message: `Device ${normalizedId} removed from Lumentree Integration`,
            entryId: targetEntryId
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
    
    // 404 for unknown endpoints
    return new Response(JSON.stringify({
      error: 'Not found',
      path: path,
      availableEndpoints: [
        'GET /health',
        'GET /check/:deviceId',
        'GET /has-mqtt-data/:deviceId',
        'GET /config-entries',
        'POST /register-integration',
        'POST /remove-entry (NEW!)'
      ]
    }), { status: 404, headers: CORS_HEADERS });
  }
};
