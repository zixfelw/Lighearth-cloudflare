# LightEarth Telegram Bot - Worker State Backup
**Date:** 2025-01-02
**Time:** ~02:20 UTC

## Current Production Worker
- **URL:** https://lightearth-telegram-bot.applike098.workers.dev
- **Version:** 2.4
- **Status:** OK
- **Users:** 34

## Health Check Response
\`\`\`json
{
  "status": "ok",
  "version": "2.4",
  "features": [
    "Fun Messages",
    "Serious Alerts",
    "Voltage Alerts",
    "Short Deep Link ≤64 chars",
    "Web UI Sync",
    "Smart Thresholds",
    "Alert Once",
    "Weather"
  ],
  "mode": "Direct_HA",
  "storage": "KV_Persistent",
  "notifications": "enabled",
  "webAPI": "enabled",
  "users": 34
}
\`\`\`

## v2.4 Key Changes
1. **Voltage x10 Deep Link** - Telegram không cho phép dấu chấm trong start parameter
   - index.html: `54.7V * 10 = 547` (gửi đi)
   - Worker: `547 / 10 = 54.7V` (parse về)
   
2. **Decimal Support** - Hỗ trợ cả dấu phẩy (50,5) và dấu chấm (50.5)

3. **Kế thừa từ v2.3:**
   - Cache HA data 6 tiếng (giảm ~98% API calls)
   - Cache Weather 1 giờ/location
   - /thresholds trong Bot Menu
   - CPU < 10ms (Free plan OK)

## Files in this version
- \`LightEarth-Bot-v2.4.js\` - Worker source code
- \`worker/worker-bot-v2.4.js\` - Same file in worker folder
- \`index.html\` - Dashboard with voltage x10 fix
- \`worker-v2.4-update.html\` - HTML page with copy button

## Deep Link Format
\`\`\`
OLD (v2.3, không hoạt động):
add_P250801055_111111_48_10_19_1_20_54.7_51.4_hcm
                                   ^^^^  ^^^^ (dấu chấm bị cấm)

NEW (v2.4, hoạt động):
add_P250801055_111111_48_10_19_1_20_547_514_hcm
                                   ^^^  ^^^ (số nguyên x10)
\`\`\`
