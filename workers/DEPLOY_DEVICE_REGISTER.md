# Deploy Device Registration Worker

## 1. Tạo Worker mới trên Cloudflare

1. Vào https://dash.cloudflare.com
2. Workers & Pages → Create Application → Create Worker
3. Đặt tên: `device-register` (hoặc giữ nguyên nếu đã có)
4. Click "Edit Code"

## 2. Copy code

Copy toàn bộ nội dung từ file `device-register-v1.0.js` vào editor

## 3. Thêm Environment Variables

Trong Worker Settings → Variables:

| Variable | Value |
|----------|-------|
| `HA_URL` | `https://collapse-universe-retrieval-layers.trycloudflare.com` |
| `HA_TOKEN` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (HA Long-lived token) |

**Lưu ý:** Token phải là Long-lived Access Token từ HA → Profile → Long-Lived Access Tokens

## 4. Deploy

Click "Deploy" và test:

```bash
# Health check
curl https://device-register.applike098.workers.dev/health

# Check device
curl https://device-register.applike098.workers.dev/check/H250325151

# Register new device
curl -X POST https://device-register.applike098.workers.dev/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "H250325151"}'
```

## 5. Verify in Home Assistant

Sau khi register, kiểm tra trong HA:
- Developer Tools → States → Tìm `sensor.lumentree_h250325151`

## Cách hoạt động

1. Dashboard gọi `/check/DEVICE_ID` để kiểm tra device có tồn tại trong HA không
2. Nếu KHÔNG có → Dashboard gọi `/register` với deviceId
3. Worker gửi MQTT Discovery messages đến HA
4. HA tự động tạo sensors cho device mới
5. Sensors sẽ hiển thị "unknown" cho đến khi inverter gửi data qua MQTT

## Lưu ý quan trọng

- Sensors được tạo qua MQTT Discovery sẽ có state "unknown" ban đầu
- Khi inverter gửi data qua MQTT topic `lumentree/{device_id}/{sensor}`, giá trị sẽ cập nhật
- Nếu inverter chưa được setup gửi MQTT, sensors sẽ không có data
