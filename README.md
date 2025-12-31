# LightEarth Cloudflare v13292

## 🔧 Latest Update: Telegram Bot v1.9.0 - Short Deep Link

### v1.9.0 (31/12/2024) ⚡ LATEST
- ✅ **Short Deep Link**: Giảm từ 75 → 44 chars (fix START_PARAM_TOO_LONG)
- ✅ **Weather Forecast**: Dự báo thời tiết 63 tỉnh/thành
- ✅ **Web UI Sync**: Đồng bộ cài đặt qua Deep Link

### v13292 (30/12/2024)
- ✅ **Fixed**: Telegram Settings section now visible when accessing via URL parameter
- ✅ **Fixed**: Device ID correctly read from `?deviceId=P250801055` URL parameter
- ✅ **Added**: JSON config files for easy reference
- ✅ **Updated**: ZIP package with all fixes

---

## 📱 Telegram Settings trên Web

Phiên bản này có tích hợp cài đặt Telegram ngay trên trang web chính.

### Tính năng:
- ✅ Section "Thông Báo Telegram" hiển thị tự động khi có deviceId
- ✅ Hỗ trợ URL parameter: `?deviceId=P250801055`
- ✅ Checkbox cài đặt loại thông báo (Chào buổi sáng, Mất điện, Pin yếu, v.v.)
- ✅ Dropdown chọn vùng thời tiết
- ✅ Nút "Lưu cài đặt" và "Mở Telegram Bot"

### Test URL:
```
https://lumentree.pages.dev/?deviceId=P250801055
```

---

## 📁 Cấu trúc file

```
├── index.html                              # Trang chính (có Telegram Settings)
├── calculator.html                         # Calculator chi tiết
├── control-voanhphong.html                 # Control panel
├── private.html                            # Private page
├── config/
│   ├── api-versions.json                   # API versions & changelog
│   └── device-config.json                  # Device config & whitelist
├── worker/
│   ├── worker-bot-v1.9.0.js                # ⚡ Latest - Short Deep Link
│   ├── worker-bot-v1.8.0.js                # Smart Thresholds
│   ├── worker-bot-v1.6.0.js                # Weather Forecast
│   └── worker-bot-v1.4.0.js                # Legacy
├── output/
│   └── LightEarth-Bot-v1.9.0-Full.html     # Deploy page with Copy button
├── workers/
│   ├── lightearth-api-gateway-v3.9.js      # Main API Gateway
│   ├── temperature-soc-power-v3.0.js       # History/Stats Worker
│   └── full-device-v4.0.js                 # Full Device Dashboard Worker
├── lightearth-v13292-telegram-fix.zip      # ZIP để upload Cloudflare Pages
└── README.md
```

---

## 📋 JSON Config Files

### config/api-versions.json
Chứa thông tin về:
- Tất cả Workers với version, endpoint, file path
- Changelog chi tiết cho từng version
- Deployment links và constants

### config/device-config.json
Chứa thông tin về:
- Whitelist devices
- Rate limiting settings
- Geo restriction config
- API endpoints
- Security config

---

## 🚀 Deploy

### 1. Cloudflare Pages (Web)
- Upload file `lightearth-v13292-telegram-fix.zip` 
- Hoặc kết nối repo này trực tiếp

### 2. Cloudflare Workers
Có 4 Workers cần deploy:

| Worker | Version | File | URL |
|--------|---------|------|-----|
| Telegram Bot | **v1.9.0** | `worker/worker-bot-v1.9.0.js` | `https://lightearth-telegram-bot.applike098.workers.dev` |
| API Gateway | v3.9 | `workers/lightearth-api-gateway-v3.9.js` | `https://lightearth.applike098.workers.dev` |
| Temp-SOC-Power | v3.0 | `workers/temperature-soc-power-v3.0.js` | `https://temperature-soc-power.applike098.workers.dev` |
| Full Device | v4.0 | `workers/full-device-v4.0.js` | `https://full-device.applike098.workers.dev` |

---

## 📅 Version History

### Web Dashboard
| Version | Date | Changes |
|---------|------|---------|
| v13292 | 30/12/2024 | Fix Telegram Settings visibility, add JSON configs |
| v13291 | 30/12/2024 | Add Telegram Settings section |

### API Gateway Changelog

#### v3.9 (Latest)
- Battery cell info (16 cells) trong realtime API
- Thêm batteryCells với num, avg, min, max, diff, cells
- Cập nhật rate/geo-restriction và whitelist P250801055
- Cache realtime 3 giây
- Giới hạn 50 req/phút/device (không áp dụng cho whitelist)
- Giới hạn 150 req/phút/IP

#### v3.8
- Thêm Cloudflare Pages origins
- Triển khai serverless 100%
- Bỏ Railway

#### v3.7
- Rate limiting theo Device ID
- Whitelist P250801055
- 50 req/phút, 5 phút block

#### v3.6
- /api/realtime/device/{deviceId} cho Direct HA
- Cache realtime 3 giây

---

## 🔧 Constants & Config

```javascript
VN_OFFSET_HOURS = 7
REALTIME_CACHE_TTL = 3  // seconds
WHITELIST_DEVICE_IDS = ['P250801055']
DEVICE_RATE_LIMIT = { maxRequests: 50, windowMs: 60000, blockDurationMs: 300000 }
IP_RATE_LIMIT = { maxRequests: 150, windowMs: 60000 }
```

---

## 🔗 Quick Links

| Resource | URL |
|----------|-----|
| Main Dashboard | https://lumentree.pages.dev/?deviceId=P250801055 |
| API Gateway | https://lightearth.applike098.workers.dev |
| Temp-SOC-Power | https://temperature-soc-power.applike098.workers.dev |
| Full Device | https://full-device.applike098.workers.dev |
| Telegram Bot | https://t.me/LightearthBot |
| GitHub Repo | https://github.com/zixfelw/Lighearth-cloudflare |

---

## 📥 Download

**Latest ZIP**: [lightearth-v13292-telegram-fix.zip](lightearth-v13292-telegram-fix.zip)

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
