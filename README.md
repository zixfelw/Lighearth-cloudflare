# LightEarth Cloudflare v13291

## 📱 Telegram Settings trên Web

Phiên bản này có tích hợp cài đặt Telegram ngay trên trang web chính.

### Tính năng mới:
- ✅ Section "Thông Báo Telegram" sau "Tổng Quát Dự Án Solar"
- ✅ Checkbox cài đặt loại thông báo
- ✅ Dropdown chọn vùng thời tiết
- ✅ Nút "Lưu cài đặt" và "Mở Telegram Bot"

---

## 📁 Cấu trúc file

```
├── index.html          # Trang chính (có Telegram Settings)
├── js/index.js         # JavaScript
├── css/index.css       # Styles
├── worker/
│   └── worker-bot-v1.4.0.js   # Cloudflare Worker Bot (Telegram)
├── workers/
│   ├── lightearth-api-gateway-v3.9.js    # Main API Gateway
│   ├── temperature-soc-power-v3.0.js     # History/Stats Worker
│   └── full-device-v4.0.js               # Full Device Dashboard Worker
├── lightearth-v13291-final.zip # ZIP để upload Cloudflare Pages
└── ...
```

---

## 🚀 Deploy

### 1. Cloudflare Pages (Web)
- Upload file `lightearth-v13291-final.zip` 
- Hoặc kết nối repo này trực tiếp

### 2. Cloudflare Workers
Có 4 Workers cần deploy:

#### 2.1 Telegram Bot Worker (worker-bot-v1.4.0.js)
- URL: `https://telegram-bot.applike098.workers.dev`
- Chức năng: Telegram Bot để nhận thông báo
- Cấu hình: 
  - `BOT_TOKEN`, `CHAT_ID`, `PI_URL`, `PI_TOKEN`
  - KV Namespace: `BOT_KV`
  - Cron Trigger: every 5 minutes

#### 2.2 LightEarth API Gateway v3.9 (lightearth-api-gateway-v3.9.js)
- URL: `https://lightearth.applike098.workers.dev`
- Chức năng: Main API cho realtime data, device info
- Tính năng:
  - Battery Cell Info (16 cells)
  - Rate limiting per device
  - Direct HA access
- Cấu hình: `PI_URL`, `PI_TOKEN`

#### 2.3 Temperature-SOC-Power Worker v3.0 (temperature-soc-power-v3.0.js)
- URL: `https://temperature-soc-power.applike098.workers.dev`
- Chức năng: History data, statistics, solar dashboard
- Tính năng:
  - Power History (288 points/day từ sensor attributes)
  - SOC/Temperature History
  - Yearly Statistics
  - Solar Savings Calculator
- Cấu hình: `HA_URL`, `HA_TOKEN`

#### 2.4 Full Device Dashboard Worker v4.0 (full-device-v4.0.js)
- URL: `https://full-device.applike098.workers.dev`
- Chức năng: Multi-device dashboard (Private)
- Tính năng:
  - `/api/cloud/devices-full` - All devices realtime
  - Summary với totalPvPower, totalLoadPower, etc
- Cấu hình: `PI_URL`, `PI_TOKEN`

---

## 🔧 Environment Variables

Tất cả Workers cần:
```
PI_URL / HA_URL     = Home Assistant URL (tunnel)
PI_TOKEN / HA_TOKEN = Home Assistant Long-Lived Access Token
```

Telegram Bot cần thêm:
```
BOT_TOKEN = Telegram Bot Token
CHAT_ID   = Telegram Chat ID
```

---

## 📅 Version History

### Web
- **v13291** (30/12/2025): Thêm Telegram Settings trên Web

### Workers
- **v1.4.0** Worker Bot: Web Settings API + Weather fallback
- **v3.9** API Gateway: Battery Cell Info (16 cells)
- **v3.0** Temperature-SOC-Power: Sensor attributes cho full 24h data
- **v4.0** Full Device: Multi-device realtime dashboard

---

## 🔗 API Endpoints Reference

### LightEarth API Gateway v3.9
```
GET /                                     # Health check
GET /api/realtime/device/{deviceId}       # Realtime device data
GET /api/realtime/daily-energy/{deviceId} # Daily energy stats
GET /api/cloud/devices                    # List all devices
GET /api/cloud/monthly/{deviceId}         # Monthly energy
GET /api/cloud/power-history/{deviceId}/{date}
GET /api/cloud/soc-history/{deviceId}/{date}
GET /api/cloud/temperature/{deviceId}/{date}
```

### Temperature-SOC-Power Worker v3.0
```
GET /api/solar/dashboard/{deviceId}       # Solar savings dashboard
GET /api/ha/statistics/{deviceId}/year?year=2025  # Yearly stats
GET /api/realtime/power-history/{deviceId}?date=2025-12-30
GET /api/realtime/power-peak/{deviceId}?date=2025-12-30
GET /api/realtime/soc-history/{deviceId}?date=2025-12-30
GET /api/realtime/daily-energy/{deviceId}
GET /api/cloud/temperature/{deviceId}/{date}
```

### Full Device Dashboard v4.0
```
GET /api/cloud/devices-full               # All devices with realtime
GET /api/cloud/devices                    # Same as above
GET /api/realtime/device/{deviceId}       # Single device realtime
```

