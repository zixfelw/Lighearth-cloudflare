# MQTT Device Verification Service

Dịch vụ xác thực thiết bị Lumentree qua MQTT trước khi đăng ký vào Home Assistant.

## 🎯 Mục đích

Khi người dùng nhập Device ID sai (VD: `H240819126` thay vì `P240819126`):
- **Trước đây**: Frontend đăng ký vào HA → HA crash → phải reset WiFi
- **Giờ đây**: Service này verify device trước → Nếu không có data → Block registration

## 🚀 Deploy

### Option 1: Render.com (Khuyên dùng - Miễn phí)

1. Tạo tài khoản tại [render.com](https://render.com)
2. New → Web Service
3. Connect GitHub repo hoặc upload code
4. Settings:
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Deploy

### Option 2: Railway

1. Tạo tài khoản tại [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Tự động detect Node.js và deploy

### Option 3: Local (Testing)

```bash
cd mqtt-verify-service
npm install
npm start
```

## 📡 API Endpoints

### GET /health
Health check

```bash
curl https://your-service.render.com/health
```

Response:
```json
{
  "status": "ok",
  "service": "mqtt-verify",
  "version": "1.0.0",
  "cacheSize": 5
}
```

### GET /verify/:deviceId
Verify device có data MQTT không

```bash
# Device đúng
curl https://your-service.render.com/verify/P240819126

# Device sai
curl https://your-service.render.com/verify/H240819126
```

**Device tồn tại:**
```json
{
  "success": true,
  "exists": true,
  "deviceId": "P240819126",
  "message": "Device P240819126 is active and sending data",
  "dataLength": 202
}
```

**Device không tồn tại:**
```json
{
  "success": true,
  "exists": false,
  "deviceId": "H240819126",
  "message": "Device H240819126 không có dữ liệu MQTT sau 8s",
  "hint": "Kiểm tra: 1) Chữ cái đầu H/P có đúng không? 2) Thiết bị có đang bật không?"
}
```

### DELETE /cache
Xóa cache (testing)

```bash
curl -X DELETE https://your-service.render.com/cache
```

## 🔧 Tích hợp với Frontend

Sau khi deploy, cập nhật frontend để gọi service này:

```javascript
const MQTT_VERIFY_SERVICE = 'https://your-service.render.com';

async function verifyDeviceViaMQTT(deviceId) {
    const response = await fetch(`${MQTT_VERIFY_SERVICE}/verify/${deviceId}`);
    return await response.json();
}
```

## 🔒 MQTT Credentials

Service sử dụng credentials từ LumentreeHA integration:
- Broker: `lesvr.suntcn.com`
- Port: `1886`
- Username: `appuser`
- Password: `app666`
- Topic: `reportApp/{deviceId}`

## ⚠️ Lưu ý

- Service chờ **8 giây** để nhận data từ MQTT
- Kết quả được cache **5 phút** để tránh gọi lại
- Nếu device offline, sẽ trả về `exists: false`
- Chỉ verify format `H` hoặc `P` + 9 số
