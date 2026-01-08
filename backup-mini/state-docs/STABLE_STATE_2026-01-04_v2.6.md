# LightEarth Bot - Stable State 2026-01-04

## Version: 2.6 - Compact Notifications

### Files:
- `LightEarth-Bot-v2.6.js` - Main worker code (72KB)
- `lightearth-bot-v2.6.html` - HTML page with copy button

### Features:
- Compact notification format (3-5 lines)
- Voltage alerts (high/low)
- Deep Link ≤64 chars
- Alert once per day per threshold
- Weather cache
- Batch KV operations

### Notification Types (13 total):
1. MẤT ĐIỆN - Pin, PV, Tải
2. CÓ ĐIỆN LẠI - Grid, Pin, Duration
3. PIN ĐẦY - Pin: X% (ngưỡng: Y%)
4. PIN THẤP - Pin: X% (ngưỡng: Y%)
5. ĐIỆN ÁP CAO - Điện áp: X.XV (ngưỡng: Y.YV)
6. ĐIỆN ÁP THẤP - Điện áp: X.XV (ngưỡng: Y.YV)
7. SẢN LƯỢNG PV - PV: XkWh (ngưỡng: YkWh)
8. ĐIỆN EVN - EVN: XkWh (ngưỡng: YkWh)
9. TIÊU THỤ - Tiêu thụ: XkWh (ngưỡng: YkWh)
10. PIN YẾU (standard) - Pin, PV, Grid
11. HẾT PV - PV, Pin, Grid
12. CHÀO BUỔI SÁNG - Pin, PV, Grid + Weather
13. BÁO CÁO MỖI GIỜ - PV, Pin, Tải, Grid

### KV Keys (same as v2.4):
- devices_data
- device_states
- threshold_alerts
- notification_flags
- ha_cache

### Deployment:
- Cloudflare Workers
- KV Namespace: BOT_KV -> LIGHTEARTH_BOT_DATA
- Cron: cron-job.org (2 min) + Cloudflare (30 min backup)

### GitHub:
- Repository: https://github.com/zixfelw/Lighearth-cloudflare
- Commit: 764e362

### Test Results:
- All 13 notification types sent successfully
- Device: P250801055
- Chat ID: 273383744
- Time: 04/01/2026 16:23:53

### Next Version: v2.7
- Keep compact format for threshold alerts
- Restore detailed format for hourly reports (like v2.4)
