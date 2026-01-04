# LightEarth Bot v2.7 - Stable State
**Date:** 2026-01-04
**Version:** 2.7 - COMPACT + DETAILED HOURLY

## Files
- `LightEarth-Bot-v2.7.js` - Full code with BOT_TOKEN
- `LightEarth-Bot-v2.7-public.js` - Redacted BOT_TOKEN
- `lightearth-bot-v2.7-complete.html` - HTML with Copy button

## Features v2.7
### Compact Notifications (từ v2.6)
- PIN ĐẦY: `Pin: 97% (ngưỡng: 95%)`
- PIN THẤP: `Pin: 18% (ngưỡng: 20%)`
- ĐIỆN ÁP CAO: `Điện áp: 54.5V (ngưỡng: 54V)`
- ĐIỆN ÁP THẤP: `Điện áp: 48.5V (ngưỡng: 49V)`
- SẢN LƯỢNG PV: `PV: 25kWh (ngưỡng: 20kWh)`
- ĐIỆN EVN: `EVN: 5.5kWh (ngưỡng: 5kWh)`
- TIÊU THỤ: `Tiêu thụ: 15kWh (ngưỡng: 12kWh)`

### Detailed Hourly (giữ nguyên v2.4)
- Weather info với mô tả, nhiệt độ, độ ẩm, gió
- PV Tips theo công suất
- Weather Tips: nắng/mây/mưa/UV
- Fun Messages random

### Compact Power Alerts (từ v2.6)
- MẤT ĐIỆN: Pin, PV, Tải
- CÓ ĐIỆN LẠI: Grid, Pin, Thời gian mất
- PIN YẾU: Pin, PV, Grid
- HẾT PV: PV, Pin, Grid

## KV Keys (same as v2.4)
- `devices_data` - User devices
- `device_states` - Device states
- `threshold_alerts` - Threshold alerts
- `notification_flags` - Notification flags

## Migration
- KHÔNG cần migration từ v2.4/v2.5/v2.6
- Dữ liệu 35 users vẫn hoạt động

## Deployment
1. Copy code từ HTML page
2. Paste vào Cloudflare Worker
3. Save and Deploy
4. Test /health → version "2.7"

## Links
- HTML: https://8080-isj57k9mcfs6m121loagj-de59bda9.sandbox.novita.ai/lightearth-bot-v2.7-complete.html
- GitHub: https://github.com/zixfelw/Lighearth-cloudflare

## Next Version
- v2.8 nếu cần thêm tính năng mới
