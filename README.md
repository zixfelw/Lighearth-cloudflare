# LightEarth Cloudflare v13291

## 📱 Web Dashboard + Telegram Bot

### Tính năng mới (v1.4.0):
- ✅ **Web Telegram Settings** - Cài đặt thông báo trực tiếp trên web
- ✅ **Weather Fallback** - Open-Meteo → wttr.in (không giới hạn)
- ✅ **Báo cáo thời tiết đầy đủ** - Nhiệt độ, độ ẩm, gió, mưa, UV

---

## 📥 Download

- **Web Pages**: `lightearth-v13291-final.zip` (4.0 MB)
- **Worker Bot**: `worker/worker.js` (61 KB)

---

## 🚀 Deploy

### 1. Cloudflare Pages (Web Dashboard)
1. Download `lightearth-v13291-final.zip`
2. Cloudflare Dashboard → Pages → Create Project
3. Upload ZIP → Deploy

### 2. Cloudflare Workers (Telegram Bot)
1. Cloudflare Dashboard → Workers → Create Worker
2. Copy nội dung từ `worker/worker.js`
3. Save and Deploy
4. Cài đặt:
   - Environment Variables: `PI_URL`, `PI_TOKEN`
   - KV Namespace: `BOT_KV`
   - Cron Trigger: `*/5 * * * *`

---

## 📂 Cấu trúc

```
├── index.html          # Trang chính
├── calculator.html     # Tính toán điện
├── css/                # Styles
├── js/                 # Scripts
├── icons/              # Icons
├── images/             # Images
├── worker/
│   └── worker.js       # Telegram Bot Worker v1.4.0
└── lightearth-v13291-final.zip  # Package đầy đủ
```

---

## 🔧 Version

- **Web**: v13291
- **Worker Bot**: v1.4.0 - Web Settings API
- **Date**: 30/12/2025
