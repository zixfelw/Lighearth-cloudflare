const BOT_TOKEN = '8471250396:AAGFvYBxwzmYQeivR0tBUPrDoqHHNnsfwdU';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Get chat_id from live worker
async function getChatId(deviceId) {
  try {
    const resp = await fetch(`https://lightearth-telegram-bot.applike098.workers.dev/kv-backup`);
    const data = await resp.json();
    const device = data.backup?.find(d => d.deviceId === deviceId);
    return device?.chatId || null;
  } catch (e) {
    return null;
  }
}

async function sendTelegram(chatId, text) {
  const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
  return (await resp.json()).ok;
}

function getVietnamTime() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', '');
}

function getBatteryIcon(soc) { 
  if (soc <= 5) return '🔴'; 
  if (soc <= 20) return '🟠'; 
  if (soc <= 50) return '🟡'; 
  if (soc <= 80) return '🟢';
  return '💚'; 
}

function getGridIcon(hasGrid) { return hasGrid ? '🟢' : '🔴'; }

function getBatteryFunStatus(soc) {
  if (soc >= 90) return '💪 Siêu đầy!';
  if (soc >= 80) return '💚 Tuyệt vời!';
  if (soc >= 60) return '🟢 Tốt lắm!';
  if (soc >= 40) return '🟡 OK';
  if (soc >= 20) return '🟠 Hơi thấp';
  return '🔴 Cần sạc!';
}

async function testAllNotifications(deviceId) {
  const chatId = await getChatId(deviceId);
  if (!chatId) {
    console.log('❌ Không tìm thấy chatId cho device:', deviceId);
    return;
  }
  
  console.log(`\n🚀 Testing v2.7 notifications for ${deviceId} (Chat: ${chatId})\n`);
  
  // Sample data
  const rt = { batterySoc: 92, pvPower: 850, loadPower: 320, gridPower: 0, batteryVoltage: 52.5 };
  const de = { pvDay: 25, gridDay: 5.5, loadDay: 15 };
  const thresholds = { batteryFull: 95, batteryLow: 20, batteryVoltHigh: 54, batteryVoltLow: 49, pvDaily: 20, gridUsage: 5, loadDaily: 12 };
  
  const notifications = [
    // 1. MẤT ĐIỆN - COMPACT
    {
      name: '⚡🔴 MẤT ĐIỆN',
      message: `⚡🔴 *MẤT ĐIỆN*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%*\nPV: *${rt.pvPower}W*\nTải: *${rt.loadPower}W*\n\n🕐 ${getVietnamTime()}`
    },
    
    // 2. CÓ ĐIỆN LẠI - COMPACT
    {
      name: '✅🟢 CÓ ĐIỆN LẠI',
      message: `✅🟢 *CÓ ĐIỆN LẠI*\n📱 \`${deviceId}\`\n\nGrid: *${rt.gridPower}W*\nPin: *${rt.batterySoc}%*\nMất điện: *25p*\n\n🕐 ${getVietnamTime()}`
    },
    
    // 3. PIN ĐẦY - COMPACT
    {
      name: '🔋💚 PIN ĐẦY',
      message: `🔋💚 *PIN ĐẦY*\n📱 \`${deviceId}\`\n\nPin: *97%* (ngưỡng: ${thresholds.batteryFull}%)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 4. PIN THẤP - COMPACT
    {
      name: '🪫🔴 PIN THẤP',
      message: `🪫🔴 *PIN THẤP*\n📱 \`${deviceId}\`\n\nPin: *18%* (ngưỡng: ${thresholds.batteryLow}%)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 5. ĐIỆN ÁP CAO - COMPACT
    {
      name: '🔌🔴 ĐIỆN ÁP CAO',
      message: `🔌🔴 *ĐIỆN ÁP CAO*\n📱 \`${deviceId}\`\n\nĐiện áp: *54.5V* (ngưỡng: ${thresholds.batteryVoltHigh}V)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 6. ĐIỆN ÁP THẤP - COMPACT
    {
      name: '🔌🟡 ĐIỆN ÁP THẤP',
      message: `🔌🟡 *ĐIỆN ÁP THẤP*\n📱 \`${deviceId}\`\n\nĐiện áp: *48.5V* (ngưỡng: ${thresholds.batteryVoltLow}V)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 7. SẢN LƯỢNG PV - COMPACT
    {
      name: '☀️🎉 SẢN LƯỢNG PV',
      message: `☀️🎉 *SẢN LƯỢNG PV*\n📱 \`${deviceId}\`\n\nPV: *${de.pvDay}kWh* (ngưỡng: ${thresholds.pvDaily}kWh)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 8. ĐIỆN EVN - COMPACT
    {
      name: '⚡⚠️ ĐIỆN EVN',
      message: `⚡⚠️ *ĐIỆN EVN*\n📱 \`${deviceId}\`\n\nEVN: *${de.gridDay}kWh* (ngưỡng: ${thresholds.gridUsage}kWh)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 9. TIÊU THỤ - COMPACT
    {
      name: '🏠📈 TIÊU THỤ',
      message: `🏠📈 *TIÊU THỤ*\n📱 \`${deviceId}\`\n\nTiêu thụ: *${de.loadDay}kWh* (ngưỡng: ${thresholds.loadDaily}kWh)\n\n🕐 ${getVietnamTime()}`
    },
    
    // 10. PIN YẾU - COMPACT
    {
      name: '🪫🔴 PIN YẾU (standard)',
      message: `🪫🔴 *PIN YẾU*\n📱 \`${deviceId}\`\n\nPin: *18%*\nPV: *50W*\nGrid: *0W* ${getGridIcon(false)}\n\n🕐 ${getVietnamTime()}`
    },
    
    // 11. HẾT PV - COMPACT
    {
      name: '🌇 HẾT PV',
      message: `🌇 *HẾT PV*\n📱 \`${deviceId}\`\n\nPV: *0W*\nPin: *${rt.batterySoc}%*\nGrid: *${rt.gridPower}W* ${getGridIcon(true)}\n\n🕐 ${getVietnamTime()}`
    },
    
    // 12. CHÀO BUỔI SÁNG - COMPACT
    {
      name: '🌅 CHÀO BUỔI SÁNG',
      message: `🌅 *Chào buổi sáng!*\n📱 \`${deviceId}\`\n\nPin: *${rt.batterySoc}%*\nPV: *${rt.pvPower}W*\nGrid: *${rt.gridPower}W*\n\n☀️ 32°C | 65% | 10% mưa\n\n🕐 ${getVietnamTime()}`
    },
    
    // 13. BÁO CÁO MỖI GIỜ - DETAILED v2.7 (like v2.4)
    {
      name: '☀️ BÁO CÁO MỖI GIỜ (CHI TIẾT v2.7)',
      message: `☀️ *BUỔI SÁNG NĂNG ĐỘNG*\nPV đang làm việc chăm chỉ, năng lượng đang tích lũy!\n\n📱 *${deviceId}*\n☀️ PV: *${rt.pvPower}W*\n${getBatteryIcon(rt.batterySoc)} Pin: *${rt.batterySoc}%* ${getBatteryFunStatus(rt.batterySoc)}\n🏠 Load: *${rt.loadPower}W*\n⚡ Grid: *${rt.gridPower}W* ${getGridIcon(true)}\n\n🌤️ *Thời tiết TP. Ho Chi Minh:*\n☀️ Trời quang\n🌡️ 32°C | 💧 65% | 💨 12 km/h\n\n☀️ _Trời nắng đẹp, PV sẽ "bung lụa" hôm nay!_\n\n⚡ _PV đang hoạt động mạnh mẽ!_\n\n🕐 ${getVietnamTime()}`
    }
  ];
  
  let sent = 0;
  for (const notif of notifications) {
    const ok = await sendTelegram(chatId, notif.message);
    console.log(`${ok ? '✅' : '❌'} ${notif.name}`);
    if (ok) sent++;
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n📊 Kết quả: ${sent}/${notifications.length} thông báo đã gửi`);
  console.log(`🕐 ${getVietnamTime()}`);
}

testAllNotifications('P250801055');
