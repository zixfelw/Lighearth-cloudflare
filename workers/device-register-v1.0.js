/**
 * Device Registration Worker v1.0
 * Auto-register new devices to Home Assistant via MQTT Discovery
 * 
 * Features:
 * - Check if device exists in HA
 * - Auto-create sensors via MQTT Discovery if device is new
 * - CORS support for Dashboard
 * 
 * Endpoints:
 * - GET /health - Health check
 * - GET /check/:deviceId - Check if device exists in HA
 * - POST /register - Register new device (auto-create sensors)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// Sensor definitions for solar inverter
const SENSOR_DEFINITIONS = [
  // Power sensors (W)
  { id: 'pv_power', name: 'PV Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'pv1_power', name: 'PV1 Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'pv2_power', name: 'PV2 Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'battery_power', name: 'Battery Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'load_power', name: 'Load Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'grid_power', name: 'Grid Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  { id: 'total_load_power', name: 'Total Load Power', unit: 'W', deviceClass: 'power', stateClass: 'measurement' },
  
  // Battery sensors
  { id: 'battery_soc', name: 'Battery SOC', unit: '%', deviceClass: 'battery', stateClass: 'measurement' },
  { id: 'battery_voltage', name: 'Battery Voltage', unit: 'V', deviceClass: 'voltage', stateClass: 'measurement' },
  { id: 'battery_current', name: 'Battery Current', unit: 'A', deviceClass: 'current', stateClass: 'measurement' },
  
  // Voltage sensors
  { id: 'pv1_voltage', name: 'PV1 Voltage', unit: 'V', deviceClass: 'voltage', stateClass: 'measurement' },
  { id: 'pv2_voltage', name: 'PV2 Voltage', unit: 'V', deviceClass: 'voltage', stateClass: 'measurement' },
  { id: 'grid_voltage', name: 'Grid Voltage', unit: 'V', deviceClass: 'voltage', stateClass: 'measurement' },
  
  // Temperature
  { id: 'device_temperature', name: 'Device Temperature', unit: '°C', deviceClass: 'temperature', stateClass: 'measurement' },
  
  // Energy sensors (kWh) - Today
  { id: 'pv_today', name: 'PV Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'charge_today', name: 'Charge Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'discharge_today', name: 'Discharge Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'grid_in_today', name: 'Grid Import Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'load_today', name: 'Load Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'essential_today', name: 'Essential Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'total_load_today', name: 'Total Load Today', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  
  // Energy sensors (kWh) - Month
  { id: 'pv_month', name: 'PV Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'charge_month', name: 'Charge Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'discharge_month', name: 'Discharge Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'grid_in_month', name: 'Grid Import Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'load_month', name: 'Load Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'total_load_month', name: 'Total Load Month', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  
  // Energy sensors (kWh) - Year
  { id: 'pv_year', name: 'PV Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'charge_year', name: 'Charge Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'discharge_year', name: 'Discharge Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'grid_in_year', name: 'Grid Import Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'load_year', name: 'Load Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  { id: 'total_load_year', name: 'Total Load Year', unit: 'kWh', deviceClass: 'energy', stateClass: 'total' },
  
  // Energy sensors (kWh) - Total
  { id: 'pv_total', name: 'PV Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'charge_total', name: 'Charge Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'discharge_total', name: 'Discharge Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'grid_in_total', name: 'Grid Import Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'load_total', name: 'Load Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' },
  { id: 'total_load_total', name: 'Total Load Total', unit: 'kWh', deviceClass: 'energy', stateClass: 'total_increasing' }
];

// Validate device ID format (P/H + 9 digits or similar)
function isValidDeviceId(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return false;
  const cleaned = deviceId.trim().toUpperCase();
  return /^[PH]\d{6,12}$/.test(cleaned);
}

// Normalize device ID
function normalizeDeviceId(deviceId) {
  return deviceId.trim().toUpperCase();
}

// Check if device exists in HA
async function checkDeviceExists(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId).toLowerCase();
  const testEntity = `sensor.device_${normalizedId}_pv_power`;
  
  try {
    const response = await fetch(`${haUrl}/api/states/${testEntity}`, {
      headers: {
        'Authorization': `Bearer ${haToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        exists: true,
        state: data.state,
        lastUpdated: data.last_updated
      };
    }
    
    return { exists: false };
  } catch (error) {
    console.error('Error checking device:', error);
    return { exists: false, error: error.message };
  }
}

// Count existing entities for a device
async function countDeviceEntities(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId).toLowerCase();
  
  try {
    const response = await fetch(`${haUrl}/api/states`, {
      headers: {
        'Authorization': `Bearer ${haToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      return { count: 0, error: `HTTP ${response.status}` };
    }
    
    const states = await response.json();
    const deviceEntities = states.filter(s => 
      s.entity_id.includes(`device_${normalizedId}`)
    );
    
    return {
      count: deviceEntities.length,
      entities: deviceEntities.slice(0, 5).map(e => e.entity_id)
    };
  } catch (error) {
    return { count: 0, error: error.message };
  }
}

// Create MQTT Discovery config for a sensor
function createMqttDiscoveryPayload(deviceId, sensor) {
  const normalizedId = normalizeDeviceId(deviceId).toLowerCase();
  const deviceName = `LumenTree ${deviceId}`;
  
  return {
    name: `${deviceId} ${sensor.name}`,
    unique_id: `lumentree_${normalizedId}_${sensor.id}`,
    state_topic: `lumentree/${normalizedId}/${sensor.id}`,
    device_class: sensor.deviceClass,
    state_class: sensor.stateClass,
    unit_of_measurement: sensor.unit,
    device: {
      identifiers: [`lumentree_${normalizedId}`],
      name: deviceName,
      manufacturer: 'LumenTree',
      model: 'Solar Inverter'
    }
  };
}

// Register device via MQTT Discovery
async function registerDevice(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId).toLowerCase();
  const results = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (const sensor of SENSOR_DEFINITIONS) {
    const topic = `homeassistant/sensor/${normalizedId}_${sensor.id}/config`;
    const payload = createMqttDiscoveryPayload(deviceId, sensor);
    
    try {
      const response = await fetch(`${haUrl}/api/services/mqtt/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          topic: topic,
          payload: JSON.stringify(payload),
          retain: true
        })
      });
      
      if (response.ok) {
        successCount++;
        results.push({ sensor: sensor.id, status: 'created' });
      } else {
        errorCount++;
        results.push({ sensor: sensor.id, status: 'error', code: response.status });
      }
    } catch (error) {
      errorCount++;
      results.push({ sensor: sensor.id, status: 'error', message: error.message });
    }
  }
  
  return {
    success: successCount > 0,
    deviceId: normalizeDeviceId(deviceId),
    sensorsCreated: successCount,
    sensorsError: errorCount,
    totalSensors: SENSOR_DEFINITIONS.length,
    results: results.slice(0, 10) // Only return first 10 results
  };
}

// Unregister device (remove MQTT Discovery configs)
async function unregisterDevice(haUrl, haToken, deviceId) {
  const normalizedId = normalizeDeviceId(deviceId).toLowerCase();
  let successCount = 0;
  
  for (const sensor of SENSOR_DEFINITIONS) {
    const topic = `homeassistant/sensor/${normalizedId}_${sensor.id}/config`;
    
    try {
      const response = await fetch(`${haUrl}/api/services/mqtt/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          topic: topic,
          payload: '', // Empty payload removes the entity
          retain: true
        })
      });
      
      if (response.ok) successCount++;
    } catch (error) {
      // Continue even if one fails
    }
  }
  
  return {
    success: successCount > 0,
    deviceId: normalizeDeviceId(deviceId),
    sensorsRemoved: successCount
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    
    const HA_URL = env.HA_URL;
    const HA_TOKEN = env.HA_TOKEN;
    
    // Health check
    if (path === '/' || path === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '1.0',
        service: 'Device Registration Worker',
        haConfigured: !!(HA_URL && HA_TOKEN),
        endpoints: [
          'GET /check/:deviceId - Check if device exists',
          'POST /register - Register new device',
          'POST /unregister - Remove device'
        ],
        sensorsSupported: SENSOR_DEFINITIONS.length
      }), { headers: CORS_HEADERS });
    }
    
    // Check HA configuration
    if (!HA_URL || !HA_TOKEN) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Home Assistant not configured'
      }), { status: 503, headers: CORS_HEADERS });
    }
    
    // GET /check/:deviceId - Check if device exists
    if (path.match(/^\/check\/([^\/]+)$/) && request.method === 'GET') {
      const match = path.match(/^\/check\/([^\/]+)$/);
      const deviceId = match[1];
      
      if (!isValidDeviceId(deviceId)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid device ID format. Expected: P/H followed by 6-12 digits'
        }), { status: 400, headers: CORS_HEADERS });
      }
      
      const existsResult = await checkDeviceExists(HA_URL, HA_TOKEN, deviceId);
      const countResult = await countDeviceEntities(HA_URL, HA_TOKEN, deviceId);
      
      return new Response(JSON.stringify({
        success: true,
        deviceId: normalizeDeviceId(deviceId),
        exists: existsResult.exists,
        entityCount: countResult.count,
        sampleEntities: countResult.entities || [],
        state: existsResult.state,
        lastUpdated: existsResult.lastUpdated
      }), { headers: CORS_HEADERS });
    }
    
    // POST /register - Register new device
    if (path === '/register' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid JSON body'
        }), { status: 400, headers: CORS_HEADERS });
      }
      
      const deviceId = body.deviceId;
      
      if (!isValidDeviceId(deviceId)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid device ID format. Expected: P/H followed by 6-12 digits'
        }), { status: 400, headers: CORS_HEADERS });
      }
      
      // Check if device already exists
      const existsResult = await checkDeviceExists(HA_URL, HA_TOKEN, deviceId);
      
      if (existsResult.exists) {
        const countResult = await countDeviceEntities(HA_URL, HA_TOKEN, deviceId);
        return new Response(JSON.stringify({
          success: true,
          message: 'Device already exists in Home Assistant',
          deviceId: normalizeDeviceId(deviceId),
          alreadyExists: true,
          entityCount: countResult.count
        }), { headers: CORS_HEADERS });
      }
      
      // Register new device
      const registerResult = await registerDevice(HA_URL, HA_TOKEN, deviceId);
      
      return new Response(JSON.stringify({
        success: registerResult.success,
        message: registerResult.success 
          ? `Device ${registerResult.deviceId} registered successfully. ${registerResult.sensorsCreated} sensors created.`
          : 'Failed to register device',
        deviceId: registerResult.deviceId,
        alreadyExists: false,
        sensorsCreated: registerResult.sensorsCreated,
        sensorsError: registerResult.sensorsError,
        note: 'Sensors are created but will show "unknown" until the inverter sends data via MQTT'
      }), { 
        status: registerResult.success ? 201 : 500, 
        headers: CORS_HEADERS 
      });
    }
    
    // POST /unregister - Remove device
    if (path === '/unregister' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid JSON body'
        }), { status: 400, headers: CORS_HEADERS });
      }
      
      const deviceId = body.deviceId;
      
      if (!isValidDeviceId(deviceId)) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid device ID format'
        }), { status: 400, headers: CORS_HEADERS });
      }
      
      const result = await unregisterDevice(HA_URL, HA_TOKEN, deviceId);
      
      return new Response(JSON.stringify({
        success: result.success,
        message: result.success 
          ? `Device ${result.deviceId} removed. ${result.sensorsRemoved} sensors deleted.`
          : 'Failed to remove device',
        deviceId: result.deviceId,
        sensorsRemoved: result.sensorsRemoved
      }), { headers: CORS_HEADERS });
    }
    
    // 404 for unknown routes
    return new Response(JSON.stringify({
      error: 'Not found',
      availableEndpoints: ['/health', '/check/:deviceId', '/register', '/unregister']
    }), { status: 404, headers: CORS_HEADERS });
  }
};
