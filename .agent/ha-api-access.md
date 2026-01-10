# Home Assistant API Access

## Cloudflare Tunnel URL
URL thay đổi mỗi lần restart tunnel. Hiện tại:
`https://knights-elementary-deputy-puts.trycloudflare.com`

## Long-lived Access Token
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI4NmQ2ODRjM2ZlZDk0MTkwYWEyNDczYTg4ZWY5NzAzNyIsImlhdCI6MTc2NzYxODY5MCwiZXhwIjoyMDgyOTc4NjkwfQ.xh_F0xqFnowQethIggNpSFTvHkTE8GCeDSwFKyQVIlE
```

## API Examples

### Get all states
```powershell
$headers = @{ "Authorization" = "Bearer <TOKEN>" }
Invoke-RestMethod -Uri "<URL>/api/states" -Headers $headers
```

### Get specific sensor
```powershell
$headers = @{ "Authorization" = "Bearer <TOKEN>" }
Invoke-RestMethod -Uri "<URL>/api/states/sensor.device_p250801055_charge_today" -Headers $headers
```

### Get sensor history (last 24h)
```powershell
$headers = @{ "Authorization" = "Bearer <TOKEN>" }
Invoke-RestMethod -Uri "<URL>/api/history/period?filter_entity_id=sensor.device_p250801055_battery_power" -Headers $headers
```

## Key Device Sensors (P250801055)
- `sensor.device_p250801055_battery_power` - Battery power (W)
- `sensor.device_p250801055_charge_today` - Charge today (Wh)
- `sensor.device_p250801055_discharge_today` - Discharge today (Wh)
- `sensor.device_p250801055_pv_power` - PV power (W)
- `sensor.device_p250801055_load_power` - Load power (W)
