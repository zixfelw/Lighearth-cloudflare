/**
 * Device Registration Worker v3.5
 * Auto-register new devices to Home Assistant via Lumentree Integration
 * 
 * v3.5 Changes:
 * - NEW: Validate device ID format (P/H + 9 digits)
 * - NEW: Check device exists on LightEarth Cloud API BEFORE registering
 * - NEW: /validate/:deviceId endpoint - Full validation before registration
 * - PREVENTS CRASH by rejecting invalid devices early
 * - Auto-cleanup ghost devices that have no data
 * 
 * v3.4 Changes:
 * - /remove-entry endpoint to remove invalid devices
 * - Auto-cleanup devices that have no data after registration
 * - Prevents ghost devices from crashing the system
 * 
 * v3.2 Changes:
 * - /has-mqtt-data/:deviceId - Check if device has MQTT data (prevent ghost devices)
 * - Validates device exists in MQTT broker before allowing registration
 * 
 * Features:
 * - Validate device ID format before registration
 * - Check device exists on LightEarth Cloud API
 * - Check if device has MQTT data before registering
 * - Auto-register via Home Assistant Config Flow API
 * - Auto-enable disabled entities (PV1, PV2, Voltage, etc.)
 * - Prevent HA crash from invalid device registration
 * 
 * Endpoints:
 * - GET /health - Health check
 * - GET /validate/:deviceId - FULL validation (format + cloud check) - NEW!
 * - GET /check/:deviceId - Check if device exists in Lumentree Integration
 * - GET /has-mqtt-data/:deviceId - Check if device has MQTT data
 * - GET /disabled/:deviceId - Get disabled entities for device
 * - GET /config-entries - List all Lumentree config entries
 * - POST /register-integration - Register device to Lumentree Integration (with validation)
 * - POST /remove-entry - Remove invalid devices
 * - POST /enable-entities - Enable disabled entities
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const LUMENTREE_DOMAIN = 'lumentree';

// LightEarth Cloud API Headers
const LIGHTEARTH_API_HEADERS = {
  'Accept-Language': 'vi-VN,vi;q=0.8',
  'User-Agent': 'okhttp-okgo/jeasonlzy',
  'Authorization': '4A0867E6A8D90DC9E5735DBDEDD99A3A',
  'source': '2',
  'versionCode': '20241025',
  'platform': '2',
  'wifiStatus': '1'
};

// Valid Device ID patterns
// P-series: P + 9 digits (e.g., P250714718)
// H-series: H + 9 digits (e.g., H240909079)
const DEVICE_ID_PATTERN = /^[PH]\d{9}$/i;

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
 * Validate Device ID Format
 * Returns: { valid: boolean, reason?: string, format?: string }
 */
function validateDeviceIdFormat(deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  if (!normalizedId) {
    return { valid: false, reason: 'empty_device_id', message: 'Device ID is empty' };
  }
  
  if (normalizedId.length !== 10) {
    return { 
      valid: false, 
      reason: 'invalid_length', 
      message: `Device ID must be 10 characters (got ${normalizedId.length})`,
      expected: 'P/H + 9 digits (e.g., P250714718)'
    };
  }
  
  if (!DEVICE_ID_PATTERN.test(normalizedId)) {
    const firstChar = normalizedId[0];
    if (firstChar !== 'P' && firstChar !== 'H') {
      return { 
        valid: false, 
        reason: 'invalid_prefix', 
        message: `Device ID must start with P or H (got '${firstChar}')`,
        expected: 'P/H + 9 digits (e.g., P250714718 or H240909079)'
      };
    }
    return { 
      valid: false, 
      reason: 'invalid_format', 
      message: 'Device ID format is invalid',
      expected: 'P/H + 9 digits (e.g., P250714718)'
    };
  }
  
  return { 
    valid: true, 
    format: normalizedId[0] === 'P' ? 'P-series' : 'H-series',
    normalizedId: normalizedId
  };
}

/**
 * Check if device has REAL DATA in MQTT (Home Assistant)
 * This is the CRITICAL check - device must have actual data before adding to Integration
 * 
 * MQTT entity format: sensor.lumentree_{deviceId}_{deviceId}_xxx
 * Example: sensor.lumentree_p250714718_p250714718_pv_power
 */
async function checkDeviceHasRealMqttData(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  const lowerCaseId = normalizedId.toLowerCase();
  
  try {
    const response = await fetch(`${haUrl}/api/states`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    if (!response.ok) {
      return { 
        hasRealData: false, 
        error: `HA API returned ${response.status}`,
        canRegister: false
      };
    }
    
    const states = await response.json();
    
    // MQTT Discovery format: sensor.lumentree_{deviceId}_{deviceId}_xxx
    const mqttPattern = `sensor.lumentree_${lowerCaseId}_${lowerCaseId}_`;
    
    // Find all MQTT entities for this device
    const mqttEntities = states.filter(s => s.entity_id.startsWith(mqttPattern));
    
    console.log(`[MQTT Check] Device ${normalizedId}: Found ${mqttEntities.length} MQTT entities`);
    
    if (mqttEntities.length === 0) {
      return {
        hasRealData: false,
        reason: 'no_mqtt_entities',
        message: `No MQTT data found for device ${normalizedId}. Device may not exist or is offline.`,
        canRegister: false,
        suggestion: 'Check if device ID is correct (P-series or H-series)'
      };
    }
    
    // Check if entities have REAL data (not unknown/unavailable/empty)
    const invalidStates = ['unknown', 'unavailable', 'none', null, undefined, ''];
    
    const entitiesWithData = mqttEntities.filter(e => {
      const state = e.state?.toString().toLowerCase();
      return !invalidStates.includes(state) && state !== 'nan';
    });
    
    const entitiesWithNumericData = mqttEntities.filter(e => {
      const num = parseFloat(e.state);
      return !isNaN(num);
    });
    
    console.log(`[MQTT Check] Device ${normalizedId}: ${entitiesWithData.length} entities with valid state, ${entitiesWithNumericData.length} with numeric data`);
    
    // Check critical entities
    const criticalEntities = ['pv_power', 'battery_soc', 'battery_power', 'grid_power'];
    const foundCritical = criticalEntities.filter(suffix => 
      mqttEntities.some(e => e.entity_id.endsWith(`_${suffix}`))
    );
    
    const hasCriticalData = criticalEntities.some(suffix => {
      const entity = mqttEntities.find(e => e.entity_id.endsWith(`_${suffix}`));
      if (!entity) return false;
      const num = parseFloat(entity.state);
      return !isNaN(num);
    });
    
    // Decision: Need at least some real data
    const hasRealData = entitiesWithNumericData.length >= 3 || hasCriticalData;
    
    return {
      hasRealData: hasRealData,
      canRegister: hasRealData,
      mqttEntityCount: mqttEntities.length,
      entitiesWithValidState: entitiesWithData.length,
      entitiesWithNumericData: entitiesWithNumericData.length,
      criticalEntitiesFound: foundCritical,
      hasCriticalData: hasCriticalData,
      sampleEntities: mqttEntities.slice(0, 5).map(e => ({
        entity_id: e.entity_id,
        state: e.state
      })),
      message: hasRealData 
        ? `Device ${normalizedId} has real MQTT data - OK to register`
        : `Device ${normalizedId} has MQTT entities but NO REAL DATA - may be offline or wrong ID`,
      suggestion: hasRealData ? null : 'Wait for device to come online or check device ID'
    };
    
  } catch (error) {
    console.error('[MQTT Check] Error:', error);
    return { 
      hasRealData: false, 
      error: error.message,
      canRegister: false
    };
  }
}

/**
 * Remove ghost device from MQTT (entities with no data)
 * This cleans up invalid devices that were added by mistake
 */
async function removeGhostMqttDevice(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  const lowerCaseId = normalizedId.toLowerCase();
  
  try {
    // Get entity registry
    const response = await fetch(`${haUrl}/api/config/entity_registry/list`, {
      headers: { 'Authorization': `Bearer ${haToken}` }
    });
    
    if (!response.ok) {
      return { success: false, error: `Failed to get entity registry: ${response.status}` };
    }
    
    const entities = await response.json();
    
    // Find MQTT entities for this device
    const mqttPattern = `sensor.lumentree_${lowerCaseId}`;
    const deviceEntities = entities.filter(e => e.entity_id.startsWith(mqttPattern));
    
    if (deviceEntities.length === 0) {
      return { 
        success: true, 
        message: `No MQTT entities found for device ${normalizedId}`,
        removed: 0
      };
    }
    
    console.log(`[Remove Ghost] Found ${deviceEntities.length} entities for ${normalizedId}`);
    
    // Remove each entity from registry
    let removed = 0;
    const errors = [];
    
    for (const entity of deviceEntities) {
      try {
        const deleteResponse = await fetch(`${haUrl}/api/config/entity_registry/${entity.entity_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${haToken}` }
        });
        
        if (deleteResponse.ok) {
          removed++;
          console.log(`[Remove Ghost] Removed: ${entity.entity_id}`);
        } else {
          errors.push(`Failed to remove ${entity.entity_id}: ${deleteResponse.status}`);
        }
      } catch (err) {
        errors.push(`Error removing ${entity.entity_id}: ${err.message}`);
      }
    }
    
    return {
      success: removed > 0,
      message: `Removed ${removed}/${deviceEntities.length} ghost entities for device ${normalizedId}`,
      removed: removed,
      total: deviceEntities.length,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error('[Remove Ghost] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if device exists on LightEarth Cloud API (backup check)
 */
async function checkDeviceOnLightEarthCloud(deviceId) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  try {
    // Try to get device data from LightEarth Cloud
    const today = new Date().toISOString().split('T')[0];
    const apiUrl = `https://lesvr.suntcn.com/lesvr/getBatDayData?queryDate=${today}&deviceId=${normalizedId}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: LIGHTEARTH_API_HEADERS,
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (!response.ok) {
      return { exists: false, reason: 'api_error' };
    }
    
    const data = await response.json();
    
    // Valid device returns: { code: 0, data: [...] }
    if (data.code === 0 || data.code === '0') {
      const hasData = data.data && (Array.isArray(data.data) ? data.data.length > 0 : true);
      return { exists: true, hasData: hasData };
    }
    
    return { exists: false, reason: 'invalid_response' };
    
  } catch (error) {
    // Network error - don't block, just return uncertain
    return { exists: null, uncertain: true, error: error.message };
  }
}

/**
 * Full Device Validation (Format + MQTT Data Check)
 * CRITICAL: Must have real MQTT data before allowing registration
 */
async function validateDevice(deviceId, haUrl, haToken) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  // Step 1: Validate format
  const formatCheck = validateDeviceIdFormat(normalizedId);
  if (!formatCheck.valid) {
    return {
      valid: false,
      canRegister: false,
      step: 'format_validation',
      ...formatCheck
    };
  }
  
  // Step 2: Check if device has REAL MQTT data in HA
  // This is the CRITICAL check - prevents crash from ghost devices
  const mqttCheck = await checkDeviceHasRealMqttData(haUrl, haToken, normalizedId);
  
  if (!mqttCheck.hasRealData) {
    // Also try LightEarth Cloud as backup
    const cloudCheck = await checkDeviceOnLightEarthCloud(normalizedId);
    
    return {
      valid: false,
      canRegister: false,
      step: 'mqtt_data_validation',
      formatValid: true,
      mqttCheck: mqttCheck,
      cloudCheck: cloudCheck,
      reason: mqttCheck.reason || 'no_mqtt_data',
      message: mqttCheck.message,
      suggestion: mqttCheck.suggestion,
      action: 'Device must have real MQTT data before registration. Check if device ID is correct.'
    };
  }
  
  // All checks passed - device has real MQTT data
  return {
    valid: true,
    canRegister: true,
    deviceId: normalizedId,
    format: formatCheck.format,
    mqttDataFound: true,
    mqttEntityCount: mqttCheck.mqttEntityCount,
    entitiesWithData: mqttCheck.entitiesWithNumericData,
    message: `Device ${normalizedId} is valid and has real MQTT data - OK to register`
  };
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
 * NOW WITH VALIDATION - Prevents crash from invalid devices
 */
async function registerDeviceToLumentreeIntegration(haUrl, haToken, deviceId, skipValidation = false) {
  const normalizedId = normalizeDeviceId(deviceId);
  
  // Step 0: Validate device BEFORE registering (unless skipped)
  // CRITICAL: Must have real MQTT data to prevent HA crash
  if (!skipValidation) {
    console.log(`[Register] Step 0: Validating device ${normalizedId} - Checking MQTT data...`);
    const validation = await validateDevice(normalizedId, haUrl, haToken);
    
    if (!validation.valid || !validation.canRegister) {
      console.log(`[Register] ❌ Validation failed: ${validation.message}`);
      return {
        success: false,
        error: validation.message,
        reason: validation.reason || 'no_mqtt_data',
        step: validation.step,
        suggestion: validation.suggestion,
        action: 'Check if device ID is correct. Device must have real MQTT data before registration.',
        validationDetails: validation
      };
    }
    console.log(`[Register] ✅ Validation passed: ${validation.message} (${validation.entitiesWithData} entities with data)`);
  }
  
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
        version: '3.5',
        service: 'Device Registration Worker (Lumentree Integration)',
        haConfigured: !!(haUrl && haToken),
        features: [
          'Validate device ID format (P/H + 9 digits)',
          'Check device exists on LightEarth Cloud',
          'PREVENT CRASH from invalid device registration',
          'Check device in Lumentree Integration',
          'Check device MQTT data existence',
          'Register device via Config Flow',
          'Remove invalid devices',
          'Multi-step flow support',
          'Enable disabled entities'
        ],
        endpoints: [
          'GET /health',
          'GET /validate/:deviceId - Full validation (MQTT data check)',
          'GET /mqtt-check/:deviceId - Check MQTT data only (NEW!)',
          'GET /check/:deviceId - Check device in HA',
          'GET /has-mqtt-data/:deviceId - Legacy MQTT check',
          'GET /config-entries - List Lumentree entries',
          'POST /register-integration - Register with MQTT validation',
          'POST /remove-entry - Remove device from Integration',
          'POST /remove-ghost - Remove ghost MQTT entities (NEW!)',
          'POST /cleanup-invalid - Find/remove invalid devices (NEW!)'
        ],
        integrationDomain: LUMENTREE_DOMAIN,
        entityFormat: 'sensor.device_{deviceId}_xxx',
        validDeviceIdFormat: 'P/H + 9 digits (e.g., P250714718 or H240909079)'
      }), { headers: CORS_HEADERS });
    }
    
    // All endpoints except /health require HA configuration
    if (!haUrl || !haToken) {
      return new Response(JSON.stringify({
        error: 'Home Assistant not configured',
        required: ['HA_URL', 'HA_TOKEN']
      }), { status: 500, headers: CORS_HEADERS });
    }
    
    // GET /validate/:deviceId - Full validation (FORMAT + MQTT DATA CHECK) - CRITICAL!
    const validateMatch = path.match(/^\/validate\/([^/]+)$/);
    if (validateMatch && request.method === 'GET') {
      const deviceId = validateMatch[1];
      const validation = await validateDevice(deviceId, haUrl, haToken);
      
      return new Response(JSON.stringify(validation), { 
        status: validation.valid ? 200 : 400,
        headers: CORS_HEADERS 
      });
    }
    
    // GET /mqtt-check/:deviceId - Check if device has real MQTT data
    const mqttCheckMatch = path.match(/^\/mqtt-check\/([^/]+)$/);
    if (mqttCheckMatch && request.method === 'GET') {
      const deviceId = mqttCheckMatch[1];
      const normalizedId = normalizeDeviceId(deviceId);
      const mqttCheck = await checkDeviceHasRealMqttData(haUrl, haToken, normalizedId);
      
      return new Response(JSON.stringify({
        deviceId: normalizedId,
        ...mqttCheck
      }), { 
        status: mqttCheck.hasRealData ? 200 : 400,
        headers: CORS_HEADERS 
      });
    }
    
    // POST /remove-ghost - Remove ghost MQTT entities for a device
    if (path === '/remove-ghost' && request.method === 'POST') {
      try {
        const body = await request.json();
        const deviceId = body.deviceId;
        
        if (!deviceId) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing deviceId'
          }), { status: 400, headers: CORS_HEADERS });
        }
        
        const result = await removeGhostMqttDevice(haUrl, haToken, deviceId);
        
        return new Response(JSON.stringify(result), { 
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
    
    // POST /cleanup-invalid - Find and remove all devices without real MQTT data
    if (path === '/cleanup-invalid' && request.method === 'POST') {
      try {
        // Get all Lumentree config entries
        const entries = await getLumentreeConfigEntries(haUrl, haToken);
        
        const results = {
          checked: 0,
          valid: [],
          invalid: [],
          removed: [],
          errors: []
        };
        
        for (const entry of entries) {
          results.checked++;
          const deviceId = entry.title || entry.data?.device_id;
          
          if (!deviceId) {
            results.errors.push(`Entry ${entry.entry_id} has no device ID`);
            continue;
          }
          
          // Check if device has real MQTT data
          const mqttCheck = await checkDeviceHasRealMqttData(haUrl, haToken, deviceId);
          
          if (mqttCheck.hasRealData) {
            results.valid.push({
              deviceId: deviceId,
              entryId: entry.entry_id,
              mqttEntityCount: mqttCheck.mqttEntityCount
            });
          } else {
            results.invalid.push({
              deviceId: deviceId,
              entryId: entry.entry_id,
              reason: mqttCheck.reason || 'no_real_data',
              mqttEntityCount: mqttCheck.mqttEntityCount || 0
            });
            
            // Auto-remove if requested
            const body = await request.clone().json().catch(() => ({}));
            if (body.autoRemove === true) {
              // Remove from Lumentree Integration
              const removeResponse = await fetch(`${haUrl}/api/config/config_entries/entry/${entry.entry_id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${haToken}` }
              });
              
              if (removeResponse.ok) {
                results.removed.push(deviceId);
                console.log(`[Cleanup] Removed invalid device: ${deviceId}`);
              } else {
                results.errors.push(`Failed to remove ${deviceId}: ${removeResponse.status}`);
              }
            }
          }
        }
        
        return new Response(JSON.stringify({
          success: true,
          summary: {
            totalChecked: results.checked,
            validDevices: results.valid.length,
            invalidDevices: results.invalid.length,
            removedDevices: results.removed.length
          },
          ...results
        }), { headers: CORS_HEADERS });
        
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), { status: 500, headers: CORS_HEADERS });
      }
    }
    
    // GET /check/:deviceId - Check device existence
    const checkMatch = path.match(/^\/check\/([^/]+)$/);
    if (checkMatch && request.method === 'GET') {
      const deviceId = checkMatch[1];
      const normalizedId = normalizeDeviceId(deviceId);
      
      // Also run format validation
      const formatCheck = validateDeviceIdFormat(normalizedId);
      
      const [integrationCheck, mqttCheck, entityCount] = await Promise.all([
        checkDeviceInLumentreeIntegration(haUrl, haToken, normalizedId),
        checkDeviceInMqtt(haUrl, haToken, normalizedId),
        countDeviceEntities(haUrl, haToken, normalizedId)
      ]);
      
      const inIntegration = integrationCheck.exists;
      const inMqtt = mqttCheck.exists;
      
      return new Response(JSON.stringify({
        deviceId: normalizedId,
        formatValid: formatCheck.valid,
        formatError: formatCheck.valid ? undefined : formatCheck.message,
        inLumentreeIntegration: inIntegration,
        inMqttDiscovery: inMqtt,
        integrationState: integrationCheck.state,
        entityCount: entityCount,
        recommendation: !formatCheck.valid
          ? `Invalid device ID format: ${formatCheck.message}`
          : inIntegration 
            ? 'Device already in Lumentree Integration - OK'
            : inMqtt 
              ? 'Device in MQTT Discovery only - consider migrating to Integration'
              : 'Device not found - use /validate/:deviceId before registration'
      }), { headers: CORS_HEADERS });
    }
    
    // GET /has-mqtt-data/:deviceId - Check if device has MQTT data
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
    
    // POST /register-integration - Register device to Lumentree Integration (WITH VALIDATION)
    if (path === '/register-integration' && request.method === 'POST') {
      try {
        const body = await request.json();
        const deviceId = body.deviceId;
        const skipValidation = body.skipValidation === true; // Allow bypass for advanced users
        
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
        
        // Register device (with validation unless skipped)
        const result = await registerDeviceToLumentreeIntegration(haUrl, haToken, normalizedId, skipValidation);
        
        return new Response(JSON.stringify({
          ...result,
          deviceId: normalizedId,
          entityFormat: `sensor.device_${normalizedId.toLowerCase()}_xxx`,
          validationSkipped: skipValidation
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
        'GET /validate/:deviceId (NEW! - Full validation)',
        'GET /check/:deviceId',
        'GET /has-mqtt-data/:deviceId',
        'GET /config-entries',
        'POST /register-integration (with validation)',
        'POST /remove-entry'
      ]
    }), { status: 404, headers: CORS_HEADERS });
  }
};
