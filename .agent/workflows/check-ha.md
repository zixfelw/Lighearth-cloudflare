---
description: Check Home Assistant sensor data via browser
---

// turbo-all

# Check HA Sensor

This workflow checks sensor data in Home Assistant using browser automation.

## Steps

1. Open browser to HA Cloudflare tunnel URL (update URL if tunnel restarts)
   - Current URL: `https://steering-topics-tee-pockets.trycloudflare.com`

2. Login credentials:
   - Username: jackytri
   - Password: Minhlong4244@

3. Navigate to Developer Tools > States

4. Filter for the sensor name provided by user

5. Return sensor state and attributes

## Usage
Just say: `/check-ha sensor.device_p250801055_charge_today`

## Notes
- Cloudflare tunnel URL changes when tunnel restarts
- Update the URL in this file when needed
- Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI4NmQ2ODRjM2ZlZDk0MTkwYWEyNDczYTg4ZWY5NzAzNyIsImlhdCI6MTc2NzYxODY5MCwiZXhwIjoyMDgyOTc4NjkwfQ.xh_F0xqFnowQethIggNpSFTvHkTE8GCeDSwFKyQVIlE
