# LightEarth Cloudflare v13291

## 📱 Telegram Settings trên Web

Phiên bản này có tích hợp cài đặt Telegram ngay trên trang web chính.

### Tính năng mới:
- ✅ Section "Thông Báo Telegram" sau "Tổng Quát Dự Án Solar"
- ✅ Checkbox cài đặt loại thông báo
- ✅ Dropdown chọn vùng thời tiết
- ✅ Nút "Lưu cài đặt" và "Mở Telegram Bot"

### Worker Bot v1.4.0:
- ✅ Weather fallback: Open-Meteo → wttr.in
- ✅ API endpoints: `/api/device-settings`, `/api/update-settings`
- ✅ Báo cáo giờ có đầy đủ thông tin thời tiết

---

## 📁 Cấu trúc file

```
├── index.html          # Trang chính (có Telegram Settings)
├── js/index.js         # JavaScript
├── css/index.css       # Styles
├── worker/
│   └── worker-bot-v1.4.0.js   # Cloudflare Worker Bot
├── lightearth-v13291-final.zip # ZIP để upload Cloudflare Pages
└── ...
```

---

## 🚀 Deploy

### 1. Cloudflare Pages (Web)
- Upload file `lightearth-v13291-final.zip` 
- Hoặc kết nối repo này trực tiếp

### 2. Cloudflare Workers (Bot)
- Copy nội dung `worker/worker-bot-v1.4.0.js`
- Paste vào Cloudflare Dashboard → Workers
- Save & Deploy

### 3. Cấu hình Worker
- Environment Variables: `PI_URL`, `PI_TOKEN`
- KV Namespace: `BOT_KV`
- Cron Trigger: every 5 minutes

---

## 📅 Version History

- **v13291** (30/12/2025): Thêm Telegram Settings trên Web
- **v1.4.0** Worker: Web Settings API + Weather fallback

