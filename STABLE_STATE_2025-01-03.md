# LightEarth Stable State - 2025-01-03

## Overview
This is the stable version of LightEarth Cloudflare Pages project.
**DO NOT modify unless explicitly requested.**

## Versions

### Cloudflare Pages
- **Source**: `lightearth-cloudflare-pages-v3.4.zip`
- **Commit**: `1f22696a` (main branch)
- **URL**: https://lumentree.pages.dev/?deviceId=P250801055

### Workers

| Worker | Version | File | Status |
|--------|---------|------|--------|
| LightEarth API Gateway | v3.9 | `workers/lightearth-api-gateway-v3.9.js` | ✅ Active |
| Device Register | v3.4 | `workers/device-register-v3.4.js` | ✅ Active |
| Temperature SOC Power | v3.0 | `workers/temperature-soc-power-v3.0.js` | ✅ Active |
| Telegram Bot | v2.4 | `worker/worker-bot-v2.4.js` | ✅ Active |

### Cloudflare Worker URLs
- **API Gateway**: `https://lightearth.applike098.workers.dev`
- **TSP Worker**: `https://temperature-soc-power.applike098.workers.dev`
- **Device Register**: `https://device-register.applike098.workers.dev`

## Key Features (v3.4)

### Device Register Worker v3.4
- `/health` - Health check
- `/check/:deviceId` - Check if device exists in HA
- `/register` - Register new device via Lumentree Integration
- `/has-mqtt-data/:deviceId` - Check if device has MQTT data
- `/remove-entry` - Remove invalid devices
- Auto-enable disabled entities (PV1, PV2, Voltage, etc.)

### API Gateway v3.9
- Real-time solar data
- Power history & analytics
- Temperature monitoring
- Device information
- Battery cell info (16 cells voltage)
- Rate limiting (50 req/min per device)
- Whitelisted device: P250801055

## Important Notes

1. **MQTT Verification Experiment (FAILED)**
   - Attempted to use Railway MQTT service for device verification
   - MQTT broker `lesvr.suntcn.com:1886` blocks cloud provider IPs
   - Reverted to HTTP API verification via Cloudflare Worker

2. **Device Verification Flow**
   - Frontend checks device exists via `/api/verify-device/{deviceId}`
   - Uses SunTCN HTTP APIs (getDevice, getBatDayData, getPVDayData)
   - Blocks registration if device not found

3. **Home Assistant Integration**
   - Uses Lumentree Integration (not MQTT Discovery)
   - Config Flow: user -> confirm_device -> create_entry
   - Auto-enables disabled entities after registration

## File Structure
```
webapp/
├── index.html              # Main dashboard
├── js/index.js             # Frontend JavaScript
├── css/index.css           # Styles
├── workers/
│   ├── lightearth-api-gateway-v3.9.js
│   ├── device-register-v3.4.js
│   ├── temperature-soc-power-v3.0.js
│   └── full-device-v4.0.js
├── worker/
│   └── worker-bot-v2.4.js  # Telegram bot
├── config/
│   ├── api-versions.json
│   └── device-config.json
└── images/, icons/, ...
```

## Restore Instructions

If you need to restore this state:
1. Download `lightearth-cloudflare-pages-v3.4.zip` from GitHub releases
2. Extract and deploy to Cloudflare Pages
3. Deploy workers from `workers/` folder to Cloudflare Workers

---
*Last updated: 2025-01-03*
*Maintained by: LightEarth Team*
