// Test script to send all notification types to a specific chat
const BOT_TOKEN = '8471250396:AAGFvYBxwzmYQeivR0tBUPrDoqHHNnsfwdU';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Get chat ID from command line or use default test
const deviceId = 'P250801055';

// We need to find the chat_id for this device from the live worker
async function getDeviceChatId() {
  try {
    const response = await fetch('https://lightearth-telegram-bot.applike098.workers.dev/kv-backup');
    const data = await response.json();
    if (data.backup) {
      const device = data.backup.find(d => d.deviceId === deviceId);
      if (device) {
        return device.chatId;
      }
    }
    return null;
  } catch (e) {
    console.error('Error fetching chat ID:', e);
    return null;
  }
}

async function sendTelegram(chatId, text) {
  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: text, 
        parse_mode: 'Markdown' 
      })
    });
    const result = await response.json();
    console.log(result.ok ? '✅ Sent' : '❌ Failed:', result.description || '');
    return result.ok;
  } catch (e) {
    console.error('Error:', e);
    return false;
  }
}

function getVietnamTime() {
  return new Date().toLocaleString('en-GB', { 
    timeZone: 'Asia/Ho_Chi_Minh', 
    hour12: false 
  }).replace(',', '');
}

async function testAllNotifications(chatId) {
  const time = getVietnamTime();
  
  console.log(`\n🧪 Testing v2.6 Compact Notifications`);
  console.log(`📱 Device: ${deviceId}`);
  console.log(`💬 Chat ID: ${chatId}`);
  console.log(`🕐 Time: ${time}`);
  console.log('━'.repeat(40));

  // 1. MẤT ĐIỆN
  console.log('\n1️⃣ MẤT ĐIỆN');
  await sendTelegram(chatId, `⚡🔴 *MẤT ĐIỆN*
📱 \`${deviceId}\`

Pin: *85%*
PV: *1200W*
Tải: *450W*

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 2. CÓ ĐIỆN LẠI
  console.log('\n2️⃣ CÓ ĐIỆN LẠI');
  await sendTelegram(chatId, `✅🟢 *CÓ ĐIỆN LẠI*
📱 \`${deviceId}\`

Grid: *2500W*
Pin: *75%*
Mất điện: *45p*

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 3. PIN ĐẦY
  console.log('\n3️⃣ PIN ĐẦY');
  await sendTelegram(chatId, `🔋💚 *PIN ĐẦY*
📱 \`${deviceId}\`

Pin: *97%* (ngưỡng: 95%)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 4. PIN THẤP
  console.log('\n4️⃣ PIN THẤP');
  await sendTelegram(chatId, `🪫🔴 *PIN THẤP*
📱 \`${deviceId}\`

Pin: *18%* (ngưỡng: 20%)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 5. ĐIỆN ÁP CAO
  console.log('\n5️⃣ ĐIỆN ÁP CAO');
  await sendTelegram(chatId, `🔌🔴 *ĐIỆN ÁP CAO*
📱 \`${deviceId}\`

Điện áp: *54.5V* (ngưỡng: 54V)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 6. ĐIỆN ÁP THẤP
  console.log('\n6️⃣ ĐIỆN ÁP THẤP');
  await sendTelegram(chatId, `🔌🟡 *ĐIỆN ÁP THẤP*
📱 \`${deviceId}\`

Điện áp: *48.5V* (ngưỡng: 49V)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 7. SẢN LƯỢNG PV
  console.log('\n7️⃣ SẢN LƯỢNG PV');
  await sendTelegram(chatId, `☀️🎉 *SẢN LƯỢNG PV*
📱 \`${deviceId}\`

PV: *25kWh* (ngưỡng: 20kWh)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 8. ĐIỆN EVN
  console.log('\n8️⃣ ĐIỆN EVN');
  await sendTelegram(chatId, `⚡⚠️ *ĐIỆN EVN*
📱 \`${deviceId}\`

EVN: *5.5kWh* (ngưỡng: 5kWh)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 9. TIÊU THỤ
  console.log('\n9️⃣ TIÊU THỤ');
  await sendTelegram(chatId, `🏠📈 *TIÊU THỤ*
📱 \`${deviceId}\`

Tiêu thụ: *15kWh* (ngưỡng: 12kWh)

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 10. PIN YẾU (standard)
  console.log('\n🔟 PIN YẾU (standard)');
  await sendTelegram(chatId, `🪫🔴 *PIN YẾU*
📱 \`${deviceId}\`

Pin: *19%*
PV: *0W*
Grid: *0W* 🔴

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 11. HẾT PV
  console.log('\n1️⃣1️⃣ HẾT PV');
  await sendTelegram(chatId, `🌇 *HẾT PV*
📱 \`${deviceId}\`

PV: *0W*
Pin: *65%*
Grid: *0W* 🔴

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 12. CHÀO BUỔI SÁNG
  console.log('\n1️⃣2️⃣ CHÀO BUỔI SÁNG');
  await sendTelegram(chatId, `🌅 *Chào buổi sáng!*
📱 \`${deviceId}\`

Pin: *92%*
PV: *150W*
Grid: *0W*

☀️ 28°C | 75% | 20% mưa

🕐 ${time}`);
  await new Promise(r => setTimeout(r, 1000));

  // 13. BÁO CÁO MỖI GIỜ
  console.log('\n1️⃣3️⃣ BÁO CÁO MỖI GIỜ');
  await sendTelegram(chatId, `☀️ *BUỔI SÁNG*
📱 \`${deviceId}\`

PV: *1850W*
Pin: *88%*
Tải: *520W*
Grid: *0W* 🟢

🕐 ${time}`);

  console.log('\n━'.repeat(40));
  console.log('✅ Đã gửi tất cả 13 loại thông báo v2.6!');
}

// Main
(async () => {
  const chatId = await getDeviceChatId();
  if (chatId) {
    await testAllNotifications(chatId);
  } else {
    console.log('❌ Không tìm thấy chat ID cho device:', deviceId);
    console.log('Thử fetch trực tiếp từ worker...');
    
    // Try direct API call
    const resp = await fetch('https://lightearth-telegram-bot.applike098.workers.dev/api/device-settings?deviceId=' + deviceId);
    const data = await resp.json();
    console.log('API Response:', data);
  }
})();
