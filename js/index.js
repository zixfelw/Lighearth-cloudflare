/**
 * Solar Monitor - Frontend JavaScript (CLOUDFLARE ONLY VERSION)
 * Version: 13291-cf - 100% Cloudflare Workers, NO Railway needed!
 * 
 * Features:
 * - Real-time data via SignalR
 * - Battery Cell monitoring (16 cells) with Day Max voltage
 * - SOC Chart V5 - Cloud data integration
 * - External HTML Tooltip (zoom-proof)
 * - Energy flow visualization
 * - Chart.js visualizations
 * - Mobile optimized interface
 * - Fallback API support with automatic failover
 */

// Global constants - defined outside DOMContentLoaded to avoid TDZ issues
// API Pool - Smart Priority Failover System
// Priority: Optimized Realtime Workers first, then Full Workers as fallback
const API_POOL = [
    // PRIORITY 1: Optimized Realtime Workers (lightweight, fast)
    {
        name: 'Realtime-1 (applike098)',
        worker: 'https://realtime.applike098.workers.dev',
        tsp: 'https://temperature-soc-power.applike098.workers.dev',
        failCount: 0,
        disabled: false,
        priority: 1
    },
    {
        name: 'Realtime-2 (dimencity996)',
        worker: 'https://realtime.dimencity996.workers.dev',
        tsp: 'https://temperature-soc-power.minhlongt358.workers.dev',
        failCount: 0,
        disabled: false,
        priority: 1
    },
    {
        name: 'Realtime-3 (jeniphernen)',
        worker: 'https://realtime.jeniphernen.workers.dev',
        tsp: 'https://temperature-soc-power.applike098.workers.dev',
        failCount: 0,
        disabled: false,
        priority: 1
    },
    // PRIORITY 2: Full Workers (fallback)
    {
        name: 'Full-1 (applike098)',
        worker: 'https://lightearth.applike098.workers.dev',
        tsp: 'https://temperature-soc-power.applike098.workers.dev',
        failCount: 0,
        disabled: false,
        priority: 2
    },
    {
        name: 'Full-2 (minhlongt358)',
        worker: 'https://lightearth-proxy.minhlongt358.workers.dev',
        tsp: 'https://temperature-soc-power.minhlongt358.workers.dev',
        failCount: 0,
        disabled: false,
        priority: 2
    }
];

// API State Management
let currentApiIndex = 0;  // Start with first API
const MAX_FAILS_PER_API = 2;  // Disable API after 2 consecutive failures
const POLLING_INTERVAL = 4000;  // 4 seconds polling

// Load Balancing: Rotate APIs after X successful fetches
const ROTATION_THRESHOLD = 5;  // Switch API after 5 successful fetches
let currentApiSuccessCount = 0;  // Track consecutive successes on current API
let lastSuccessfulApiName = null;  // Track which API was last successful

// Primary API for daily-energy (has proper CORS headers)
const DAILY_ENERGY_API = 'https://lightearth.applike098.workers.dev';

// Global state for realtime data - MUST be declared early to avoid TDZ errors
let latestRealtimeData = {};

// Global state variables - MUST be declared outside DOMContentLoaded to avoid TDZ errors
let deviceNotFoundShown = false;
let previousValues = {};
let powerTimelineChart = null;
let powerStackedChart = null;  // Chart 2 - Area Chart (improved)
let activeChartNumber = 1;     // 1 = Line Chart, 2 = Area Chart
let cachedChartData = null;    // Cache timeline data to reuse between charts
let tempChartInstance = null;  // Temperature Chart instance
let activeSocTempTab = 'soc';  // 'soc' or 'temp' - current active tab
let lastHapticTime = 0;        // Throttle haptic feedback
const HAPTIC_THROTTLE_MS = 100; // Minimum time between haptic feedbacks
let cachedTempData = null;     // Cache temperature timeline data
let temperatureCache = {
    data: null,
    timestamp: 0,
    deviceId: null,
    date: null
};
let socCache = {
    data: null,
    timestamp: 0,
    deviceId: null,
    date: null
};

// More global state variables to avoid TDZ errors
let socChartInstance = null;
let socData = [];
let socApiStats = { min: null, max: null, minTime: null, maxTime: null }; // Store API-calculated min/max
let lastCellsFetch = 0;
let socAutoReloadInterval = null;
const CELLS_FETCH_INTERVAL = 5000; // Min 5s between fetches
const LIGHTEARTH_PROXY_API = 'https://lightearth-proxy.minhlongt358.workers.dev';

// Haptic feedback for chart interactions (throttled)
// Browser will silently ignore vibrate() until user gesture, then it works
function triggerHaptic(durationMs = 5) {
    const now = Date.now();
    if (navigator.vibrate && (now - lastHapticTime) > HAPTIC_THROTTLE_MS) {
        try {
            navigator.vibrate(durationMs);
            lastHapticTime = now;
        } catch (e) {
            // Silently ignore if vibrate fails (no user gesture yet)
        }
    }
}

// Auto-enable haptic by simulating user gesture on page load
// Click SOC button (default tab) after short delay to enable vibration API
setTimeout(() => {
    const socBtn = document.getElementById('socChartBtn');
    if (socBtn) {
        socBtn.click();
        console.log('🔔 Auto-clicked SOC button to enable haptic feedback');
    }
}, 1500); // Wait 1.5s for page to fully load


// Get current API (round-robin with health check)
function getNextHealthyApi() {
    // Try to find a healthy API starting from current index
    for (let i = 0; i < API_POOL.length; i++) {
        const index = (currentApiIndex + i) % API_POOL.length;
        if (!API_POOL[index].disabled) {
            currentApiIndex = index;
            return API_POOL[index];
        }
    }
    // All APIs disabled - reset all and try first one
    console.warn('⚠️ All APIs disabled, resetting...');
    API_POOL.forEach(api => {
        api.disabled = false;
        api.failCount = 0;
    });
    currentApiIndex = 0;
    return API_POOL[0];
}

// Alternating load balancing - switch between APIs each call
let lastUsedApiIndex = -1;  // Track last used API for alternating
let lastUsedPriority1Index = -1;  // Track within priority 1
let lastUsedPriority2Index = -1;  // Track within priority 2

function getAlternatingHealthyApi() {
    // Separate APIs by priority
    const priority1Apis = API_POOL.filter(api => api.priority === 1 && !api.disabled);
    const priority2Apis = API_POOL.filter(api => api.priority === 2 && !api.disabled);

    // Try Priority 1 (optimized realtime) first
    if (priority1Apis.length > 0) {
        lastUsedPriority1Index = (lastUsedPriority1Index + 1) % priority1Apis.length;
        const api = priority1Apis[lastUsedPriority1Index];
        console.log(`🚀 Using ${api.name} (Priority 1 - Realtime)`);
        return api;
    }

    // Fallback to Priority 2 (full workers)
    if (priority2Apis.length > 0) {
        lastUsedPriority2Index = (lastUsedPriority2Index + 1) % priority2Apis.length;
        const api = priority2Apis[lastUsedPriority2Index];
        console.log(`🔄 Using ${api.name} (Priority 2 - Fallback)`);
        return api;
    }

    // All disabled - reset all and return first
    console.warn('⚠️ All APIs disabled, resetting...');
    API_POOL.forEach(api => {
        api.disabled = false;
        api.failCount = 0;
    });
    lastUsedPriority1Index = 0;
    lastUsedPriority2Index = -1;
    return API_POOL[0];
}

// Get random healthy API (different from last one used) for load balancing
function getRandomHealthyApi(excludeApiName = null) {
    // Get all healthy APIs sorted by priority
    const priority1Apis = API_POOL.filter(api => api.priority === 1 && !api.disabled);
    const priority2Apis = API_POOL.filter(api => api.priority === 2 && !api.disabled);

    // Prefer Priority 1 APIs
    let candidates = priority1Apis.length > 0 ? priority1Apis : priority2Apis;

    // If we have more than 1 candidate, exclude the last used one
    if (candidates.length > 1 && excludeApiName) {
        candidates = candidates.filter(api => api.name !== excludeApiName);
    }

    // Still no candidates? Reset all and return first
    if (candidates.length === 0) {
        console.warn('⚠️ No healthy APIs for random selection, resetting...');
        API_POOL.forEach(api => {
            api.disabled = false;
            api.failCount = 0;
        });
        return API_POOL[0];
    }

    // Random selection
    const randomIndex = Math.floor(Math.random() * candidates.length);
    const selectedApi = candidates[randomIndex];
    console.log(`🎲 Random API rotation: ${selectedApi.name} (from ${candidates.length} candidates)`);
    return selectedApi;
}

// Get current API endpoints (alternating load balancing)
function getCurrentWorkerAPI() {
    return getAlternatingHealthyApi().worker;
}

function getCurrentWorkerTSP() {
    return getAlternatingHealthyApi().tsp;
}

function getCurrentPollingInterval() {
    return POLLING_INTERVAL;
}

// Mark API as failed
function markApiFailed(apiUrl) {
    const api = API_POOL.find(a => apiUrl.includes(a.worker.replace('https://', '').split('.')[0]));
    if (api) {
        api.failCount++;
        console.warn(`⚠️ ${api.name} fail count: ${api.failCount}/${MAX_FAILS_PER_API}`);
        if (api.failCount >= MAX_FAILS_PER_API) {
            api.disabled = true;
            console.error(`❌ ${api.name} DISABLED after ${MAX_FAILS_PER_API} failures`);
        }
    }
}

// Mark API as successful - reset fail count
function markApiSuccess(apiUrl) {
    const api = API_POOL.find(a => apiUrl.includes(a.worker.replace('https://', '').split('.')[0]));
    if (api && api.failCount > 0) {
        api.failCount = 0;
        console.log(`✅ ${api.name} recovered, fail count reset`);
    }
}

// Legacy compatibility functions
function switchToFallbackAPI() {
    // Now handled by markApiFailed
}

function tryPrimaryAPI() {
    // Now handled automatically by getAlternatingHealthyApi
}

// Note: SOC and Power History APIs now use getCurrentWorkerTSP() for fallback support
// See getSocApiUrl() and getPowerHistoryApiUrl() functions

// ========================================
// GLOBAL FUNCTIONS - Available immediately for onclick handlers
// Must be outside DOMContentLoaded for mobile compatibility
// ========================================

// Switch between Pro, Basic, and 3D Home Energy Flow views
window.switchEnergyFlowView = function (view) {
    console.log('[switchEnergyFlowView] Called with view:', view);

    const proView = document.getElementById('energyFlowPro');
    const basicView = document.getElementById('energyFlowBasic');
    const home3DView = document.getElementById('energyFlow3DHome');
    const proBtn = document.getElementById('proViewBtn');
    const basicBtn = document.getElementById('basicViewBtn');
    const home3DBtn = document.getElementById('home3DViewBtn');

    if (!proView || !basicView) {
        console.warn('Energy flow views not found, retrying in 100ms...');
        setTimeout(() => window.switchEnergyFlowView(view), 100);
        return;
    }

    // Helper function to reset all buttons to inactive state
    const resetAllButtons = () => {
        const inactiveClasses = ['text-slate-600', 'dark:text-slate-300', 'hover:text-slate-800', 'dark:hover:text-slate-100'];
        const activeClasses = ['bg-teal-500', 'text-white', 'shadow-sm'];

        [proBtn, basicBtn, home3DBtn].forEach(btn => {
            if (btn) {
                btn.classList.remove(...activeClasses);
                btn.classList.add(...inactiveClasses);
            }
        });
    };

    // Helper function to set button as active
    const setActiveButton = (btn) => {
        if (btn) {
            btn.classList.remove('text-slate-600', 'dark:text-slate-300', 'hover:text-slate-800', 'dark:hover:text-slate-100');
            btn.classList.add('bg-teal-500', 'text-white', 'shadow-sm');
        }
    };

    // Hide all views first
    proView.classList.add('hidden');
    basicView.classList.add('hidden');
    if (home3DView) home3DView.classList.add('hidden');

    // Reset all buttons
    resetAllButtons();

    if (view === 'basic') {
        basicView.classList.remove('hidden');
        setActiveButton(basicBtn);
        if (typeof window.autoSyncBasicView === 'function') {
            window.autoSyncBasicView();
        }
    } else if (view === '3dhome') {
        if (home3DView) {
            home3DView.classList.remove('hidden');
            setActiveButton(home3DBtn);
            if (typeof window.autoSync3DHomeView === 'function') {
                window.autoSync3DHomeView();
            }
        } else {
            proView.classList.remove('hidden');
            setActiveButton(proBtn);
        }
    } else {
        proView.classList.remove('hidden');
        setActiveButton(proBtn);
    }

    localStorage.setItem('energyFlowView', view);
    console.log('Energy flow view switched to:', view);
};

// ========================================
// AUTO-SYNC FUNCTIONS - DEFINED OUTSIDE DOMContentLoaded
// These MUST be available BEFORE updateRealTimeDisplay is called
// ========================================

// Auto-sync data to 3D Home view elements
window.autoSync3DHomeView = function () {
    // Get current values from Pro view (same format as Pro)
    const pvPower = document.getElementById('pv-power')?.textContent || '--W';
    const gridPower = document.getElementById('grid-power')?.textContent || '--W';
    const batteryPercent = document.getElementById('battery-percent-icon')?.textContent || '--%';
    const batteryPower = document.getElementById('battery-power')?.textContent || '--W';
    const batteryVoltage = document.getElementById('battery-voltage-pro')?.textContent || '--V';
    const batteryCurrent = document.getElementById('battery-current-pro')?.textContent || '--A';
    const loadPower = document.getElementById('load-power')?.textContent || '--W';
    const essentialPower = document.getElementById('essential-power')?.textContent || '--W';

    // Get PV1/PV2 power and voltage from stored realtime data
    let pv1Power = '--W', pv2Power = '--W';
    let pv1Voltage = '--V', pv2Voltage = '--V';
    if (latestRealtimeData && latestRealtimeData.pv1Power) {
        pv1Power = latestRealtimeData.pv1Power + 'W';
        pv1Voltage = (latestRealtimeData.pv1Voltage || 0) + 'V';
    }
    if (latestRealtimeData && latestRealtimeData.pv2Power) {
        pv2Power = latestRealtimeData.pv2Power + 'W';
        pv2Voltage = (latestRealtimeData.pv2Voltage || 0) + 'V';
    }

    // Update 3D Home view elements with blink effect
    const update3DValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            const oldValue = el.textContent;
            if (oldValue !== value) {
                el.textContent = value;
                el.classList.remove('value-updated');
                void el.offsetWidth; // Force reflow
                el.classList.add('value-updated');
                setTimeout(() => el.classList.remove('value-updated'), 600);
            }
        }
    };

    // Update power displays
    update3DValue('pv-power-3d', pvPower);
    update3DValue('pv1-power-3d', pv1Power);
    update3DValue('pv2-power-3d', pv2Power);
    update3DValue('pv1-voltage-3d', pv1Voltage);
    update3DValue('pv2-voltage-3d', pv2Voltage);
    update3DValue('grid-power-3d', gridPower);
    update3DValue('load-power-3d', loadPower);
    update3DValue('battery-soc-3d', batteryPercent);

    // Update battery SOC color based on percentage: Red 1-20%, Yellow 21-50%, Green 51-100%
    const batterySocEl = document.getElementById('battery-soc-3d');
    if (batterySocEl) {
        const socValue = parseInt(batteryPercent.replace(/[^\d]/g, '')) || 0;
        // Remove old color classes
        batterySocEl.classList.remove('text-red-500', 'text-yellow-500', 'text-emerald-400', 'text-white');
        if (socValue <= 20) {
            batterySocEl.classList.add('text-red-500'); // Red for 1-20%
        } else if (socValue <= 50) {
            batterySocEl.classList.add('text-yellow-500'); // Yellow for 21-50%
        } else {
            batterySocEl.classList.add('text-emerald-400'); // Green for 51-100%
        }
    }

    update3DValue('essential-power-3d', essentialPower);

    // Update Grid EVN voltage
    const gridVoltage = document.getElementById('grid-voltage')?.textContent || '--V';
    update3DValue('grid-voltage-3d', gridVoltage);

    // Update battery voltage display
    update3DValue('battery-voltage-3d', batteryVoltage);

    // Update battery current display
    update3DValue('battery-current-3d', batteryCurrent);

    // Update battery card power display
    const batteryPowerVal = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
    const batteryPowerEl = document.getElementById('battery-power-3d');
    const batteryStatusLabelEl = document.getElementById('battery-status-label-3d');

    if (batteryPowerEl) {
        let newValue;
        if (batteryPowerVal > 10) {
            newValue = '+' + Math.abs(batteryPowerVal) + 'W';
            if (batteryStatusLabelEl) batteryStatusLabelEl.textContent = 'Pin đang sạc';
        } else if (batteryPowerVal < -10) {
            newValue = '-' + Math.abs(batteryPowerVal) + 'W';
            if (batteryStatusLabelEl) batteryStatusLabelEl.textContent = 'Pin đang xả';
        } else {
            newValue = '0W';
            if (batteryStatusLabelEl) batteryStatusLabelEl.textContent = 'Pin chờ';
        }
        // Apply value with blink animation
        if (batteryPowerEl.textContent !== newValue) {
            batteryPowerEl.textContent = newValue;
            batteryPowerEl.classList.remove('value-updated');
            void batteryPowerEl.offsetWidth;
            batteryPowerEl.classList.add('value-updated');
            setTimeout(() => batteryPowerEl.classList.remove('value-updated'), 600);
        }
    }

    // Update battery % icon
    const batteryPercentIconEl = document.getElementById('battery-percent-3d-icon');
    if (batteryPercentIconEl) {
        batteryPercentIconEl.textContent = batteryPercent;
    }

    // Update battery fill bar and color based on SOC level
    const batteryPercentNum = parseInt(batteryPercent.replace(/[^\d]/g, '')) || 0;
    const batteryFillEl = document.getElementById('battery-fill-3d');
    const batteryBodyEl = document.getElementById('battery-body-3d');
    const batteryCapEl = document.getElementById('battery-cap-3d');

    // Color based on SOC: Red 1-20%, Yellow 21-50%, Green 51-100%
    let fillColorClass = 'bg-emerald-500';
    let borderColorClass = 'border-emerald-400';
    let capColorClass = 'bg-emerald-400';
    if (batteryPercentNum <= 20) {
        fillColorClass = 'bg-red-500';
        borderColorClass = 'border-red-400';
        capColorClass = 'bg-red-400';
    } else if (batteryPercentNum <= 50) {
        fillColorClass = 'bg-yellow-500';
        borderColorClass = 'border-yellow-400';
        capColorClass = 'bg-yellow-400';
    }

    if (batteryFillEl) {
        batteryFillEl.style.width = Math.max(batteryPercentNum - 3, 0) + '%';
        batteryFillEl.className = `battery-fill-3d absolute left-0.5 top-0.5 bottom-0.5 rounded-[3px] ${fillColorClass} transition-all duration-500`;
    }
    if (batteryBodyEl) {
        batteryBodyEl.className = `battery-body-3d w-16 h-7 sm:w-20 sm:h-8 rounded-[5px] border-2 ${borderColorClass} relative overflow-hidden bg-slate-900/80 transition-all duration-300`;
    }
    if (batteryCapEl) {
        batteryCapEl.className = `absolute -right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-4 sm:h-5 ${capColorClass} rounded-r-sm transition-all duration-300`;
    }

    // Sun/Moon Animation Control
    const pvValue = parseInt(pvPower.replace(/[^\d-]/g, '')) || 0;
    const sun3D = document.getElementById('sun-3d');
    const moon3D = document.getElementById('moon-3d');

    if (sun3D && moon3D) {
        if (pvValue > 0) {
            sun3D.classList.remove('hidden');
            moon3D.classList.add('hidden');
        } else {
            sun3D.classList.add('hidden');
            moon3D.classList.remove('hidden');
        }
    }

    // PV Energy Flow Line
    const pvEnergyLine = document.getElementById('pv-energy-line');
    if (pvEnergyLine) {
        if (pvValue > 0) {
            pvEnergyLine.classList.remove('hidden-flow');
        } else {
            pvEnergyLine.classList.add('hidden-flow');
        }
    }

    // EVN Grid Energy Flow Line
    const gridValue = parseInt(gridPower.replace(/[^\d-]/g, '')) || 0;
    const evnEnergyLine = document.getElementById('evn-energy-line');
    if (evnEnergyLine) {
        evnEnergyLine.classList.remove('hidden-flow', 'flow-level-1', 'flow-level-2', 'flow-level-3');
        if (gridValue > 0) {
            if (gridValue > 1000) {
                evnEnergyLine.classList.add('flow-level-3');
            } else if (gridValue > 20) {
                evnEnergyLine.classList.add('flow-level-2');
            } else {
                evnEnergyLine.classList.add('flow-level-1');
            }
        } else {
            evnEnergyLine.classList.add('hidden-flow');
        }
    }

    // Battery charge/discharge animation
    const batteryVal = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
    const chargingIcon = document.getElementById('battery-charging-3d');
    const dischargingIcon = document.getElementById('battery-discharging-3d');
    const statusIcon = document.getElementById('battery-status-icon-3d');

    if (statusIcon) {
        if (batteryVal > 10) {
            statusIcon.classList.remove('hidden');
            chargingIcon?.classList.remove('hidden');
            dischargingIcon?.classList.add('hidden');
        } else if (batteryVal < -10) {
            statusIcon.classList.remove('hidden');
            chargingIcon?.classList.add('hidden');
            dischargingIcon?.classList.remove('hidden');
        } else {
            statusIcon.classList.add('hidden');
        }
    }
};

// Auto-sync data to Basic view elements
window.autoSyncBasicView = function () {
    // Get current values from Pro view
    const pvPower = document.getElementById('pv-power')?.textContent || '--';
    const pvDesc = document.getElementById('pv-desc')?.innerHTML || '--';
    const gridPower = document.getElementById('grid-power')?.textContent || '--';
    const gridVoltage = document.getElementById('grid-voltage')?.textContent || '--';
    const batteryPercent = document.getElementById('battery-percent-icon')?.textContent || '--%';
    const batteryPower = document.getElementById('battery-power')?.textContent || '--';
    const batteryVoltage = document.getElementById('battery-voltage-pro')?.textContent || '--V';
    const batteryCurrent = document.getElementById('battery-current-pro')?.textContent || '--A';
    const essentialPower = document.getElementById('essential-power')?.textContent || '--';
    const loadPower = document.getElementById('load-power')?.textContent || '--';
    const deviceTemp = document.getElementById('device-temp')?.textContent || '--';
    const inverterType = document.getElementById('inverter-type')?.textContent || '--';

    // Helper function to update with blink effect
    const updateBasicValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            const oldValue = el.textContent;
            if (oldValue !== value) {
                el.textContent = value;
                el.classList.remove('value-updated');
                void el.offsetWidth;
                el.classList.add('value-updated');
                setTimeout(() => el.classList.remove('value-updated'), 600);
            }
        }
    };

    const updateBasicHTML = (id, html) => {
        const el = document.getElementById(id);
        if (el) {
            const oldHTML = el.innerHTML;
            if (oldHTML !== html) {
                el.innerHTML = html;
                el.classList.remove('value-updated');
                void el.offsetWidth;
                el.classList.add('value-updated');
                setTimeout(() => el.classList.remove('value-updated'), 600);
            }
        }
    };

    // Update Basic view elements
    updateBasicValue('pv-power-basic', pvPower);
    updateBasicHTML('pv-desc-basic', pvDesc);
    updateBasicValue('grid-power-basic', gridPower);
    updateBasicValue('grid-voltage-basic', gridVoltage);
    updateBasicValue('battery-percent-basic', batteryPercent);
    updateBasicValue('battery-power-basic', batteryPower);
    updateBasicValue('battery-voltage-basic', batteryVoltage);
    updateBasicValue('battery-current-basic', batteryCurrent);
    updateBasicValue('essential-power-basic', essentialPower);
    updateBasicValue('load-power-basic', loadPower);
    updateBasicValue('device-temp-basic', deviceTemp);
    updateBasicValue('inverter-type-basic', inverterType);

    // Update battery status text and colors
    const powerValue = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
    const batteryStatusTextBasic = document.getElementById('battery-status-text-basic');

    if (batteryStatusTextBasic) {
        if (powerValue > 0) {
            batteryStatusTextBasic.textContent = 'Đang sạc';
            batteryStatusTextBasic.className = 'text-xs font-medium text-emerald-500 dark:text-emerald-400';
        } else if (powerValue < 0) {
            batteryStatusTextBasic.textContent = 'Đang xả';
            batteryStatusTextBasic.className = 'text-xs font-medium text-orange-500 dark:text-orange-400';
        } else {
            batteryStatusTextBasic.textContent = 'Chờ';
            batteryStatusTextBasic.className = 'text-xs font-medium text-slate-500 dark:text-slate-400';
        }
    }

    // Update battery power colors
    const batteryPowerBasic = document.getElementById('battery-power-basic');
    if (batteryPowerBasic) {
        batteryPowerBasic.classList.remove(
            'text-slate-700', 'dark:text-slate-300',
            'text-emerald-500', 'dark:text-emerald-400',
            'text-orange-500', 'dark:text-orange-400'
        );
        if (powerValue > 0) {
            batteryPowerBasic.classList.add('text-emerald-500', 'dark:text-emerald-400');
        } else if (powerValue < 0) {
            batteryPowerBasic.classList.add('text-orange-500', 'dark:text-orange-400');
        } else {
            batteryPowerBasic.classList.add('text-slate-700', 'dark:text-slate-300');
        }
    }
};

console.log('✅ window.autoSync3DHomeView and window.autoSyncBasicView defined GLOBALLY');

document.addEventListener('DOMContentLoaded', function () {
    // ========================================
    // INITIALIZATION
    // ========================================

    // Set up today's date as default
    const today = new Date();
    const dateInput = document.getElementById('dateInput');
    if (dateInput) {
        dateInput.value = formatDate(today);
    }

    // Initialize energy chart date picker with today's date
    const energyDatePicker = document.getElementById('energy-chart-date-picker');
    if (energyDatePicker) {
        energyDatePicker.value = today.toISOString().split('T')[0];
    }

    // Get deviceId from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdParam = urlParams.get('deviceId');
    if (deviceIdParam) {
        const deviceIdInput = document.getElementById('deviceId');
        if (deviceIdInput) {
            deviceIdInput.value = deviceIdParam;
        }
    }

    // Handle Enter key in deviceId input
    const deviceIdInput = document.getElementById('deviceId');
    if (deviceIdInput) {
        deviceIdInput.addEventListener('keypress', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                fetchData();
            }
        });
    }

    // Configure Chart.js defaults
    configureChartDefaults();

    // Chart objects
    let combinedEnergyChart;

    // SignalR connection
    let connection;
    let currentDeviceId = '';

    // Connection status tracking
    let systemConnected = false;
    let httpApiConnected = false;
    let lastHttpApiUpdate = 0;

    // Animation mode: true = reduced (1 particle only - default), false = normal (multiple particles)
    // Load saved preference from localStorage, default to true (reduced) if not set
    let reducedAnimationMode = localStorage.getItem('energyFlowAnimationMode') !== 'normal';

    // ============================================================
    // 🌐 CLOUDFLARE ONLY VERSION - NO RAILWAY NEEDED!
    // All APIs go through Cloudflare Workers (FREE forever)
    // ============================================================

    // Primary Cloudflare Worker (has all endpoints)
    const CLOUDFLARE_WORKER = 'https://lightearth.applike098.workers.dev';
    const CLOUDFLARE_WORKER_TSP = 'https://temperature-soc-power.applike098.workers.dev';

    // Device Registration Worker (for auto-registering new devices to HA)
    const DEVICE_REGISTER_WORKER = 'https://device-register.applike098.workers.dev';

    // Keep currentOrigin for backward compatibility (but not used for API calls)
    const currentOrigin = window.location.origin;

    // API Configuration - 100% Cloudflare Workers
    const API_SOURCES = {
        cloudflare: {
            name: 'Cloudflare Workers (FREE)',
            realtime: `${CLOUDFLARE_WORKER}/api/realtime/device`,
            isLocal: false
        }
    };

    // ALL APIs use Cloudflare Workers - ZERO Railway needed!
    const LIGHTEARTH_API = {
        get base() { return CLOUDFLARE_WORKER; },
        // Monthly/Yearly data - Cloudflare Worker
        month: (deviceId) => `${CLOUDFLARE_WORKER}/api/month/${deviceId}`,
        year: (deviceId) => `${CLOUDFLARE_WORKER}/api/year/${deviceId}`,
        historyYear: (deviceId) => `${CLOUDFLARE_WORKER}/api/history-year/${deviceId}`,
        // Cloud endpoints - Cloudflare Workers
        cloudPowerHistory: (deviceId, date) => `${getCurrentWorkerTSP()}/api/realtime/power-history/${deviceId}?date=${date}`,
        cloudSocHistory: (deviceId, date) => `${getCurrentWorkerTSP()}/api/realtime/soc-history/${deviceId}?date=${date}`,
        cloudTemperature: (deviceId, date) => `${getCurrentWorkerTSP()}/api/cloud/temperature/${deviceId}/${date}`,
        cloudPowerPeak: (deviceId, date) => `${getCurrentWorkerTSP()}/api/realtime/power-peak/${deviceId}?date=${date}`,
        // These also use Cloudflare Workers now!
        cloudStates: (deviceId) => `${CLOUDFLARE_WORKER}/api/cloud/states/${deviceId}`,
        cloudDeviceInfo: (deviceId) => `${CLOUDFLARE_WORKER}/api/cloud/device-info/${deviceId}`
    };

    // Simplified - all through Cloudflare
    function getCurrentProxy() { return CLOUDFLARE_WORKER; }
    function switchToFallbackProxy() { return CLOUDFLARE_WORKER; }
    function resetToPrimaryProxy() { }

    // Simplified fetch - all APIs on Railway now (no proxy fallback needed)
    async function fetchWithProxyFallback(urlBuilder, options = {}) {
        const url = typeof urlBuilder === 'function' ? urlBuilder() : urlBuilder;
        console.log(`📡 [Railway API] Fetching: ${url}`);

        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    }

    // Lightearth API cache - refresh every 10 minutes
    let lightearthCache = {
        data: null,
        deviceId: null,
        date: null,
        timestamp: 0
    };
    const LIGHTEARTH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache

    // LocalStorage cache keys for persistent caching across page reloads
    const LS_CACHE_KEYS = {
        lightearthData: 'solar_lightearth_cache',
        chartData: 'solar_chart_cache',
        summaryData: 'solar_summary_cache'
    };

    // Load cached data from localStorage on startup
    // ONLY load if cached deviceId matches current URL deviceId
    function loadCacheFromLocalStorage() {
        try {
            // Get deviceId from URL to validate cache
            const urlDeviceId = new URLSearchParams(window.location.search).get('deviceId');
            console.log(`🔍 URL deviceId: ${urlDeviceId}`);

            // Load chart/lightearth cache - ONLY if device matches
            const cached = localStorage.getItem(LS_CACHE_KEYS.lightearthData);
            if (cached) {
                const parsed = JSON.parse(cached);
                const age = Date.now() - parsed.timestamp;

                // Check if cache is for current device AND not expired
                if (urlDeviceId && parsed.deviceId !== urlDeviceId) {
                    console.log(`🔄 Cache device (${parsed.deviceId}) != URL device (${urlDeviceId}), clearing cache`);
                    localStorage.removeItem(LS_CACHE_KEYS.lightearthData);
                } else if (age < LIGHTEARTH_CACHE_TTL) {
                    console.log(`📦 Loaded Lightearth cache from localStorage (age: ${Math.round(age / 1000)}s, device: ${parsed.deviceId}, date: ${parsed.date})`);
                    lightearthCache = parsed;
                } else {
                    console.log('⚠️ LocalStorage cache expired, clearing');
                    localStorage.removeItem(LS_CACHE_KEYS.lightearthData);
                }
            }

            // Load summary cache - ONLY if device matches
            const summaryCached = localStorage.getItem(LS_CACHE_KEYS.summaryData);
            if (summaryCached) {
                const parsed = JSON.parse(summaryCached);
                const age = Date.now() - parsed.timestamp;

                // Check if cache is for current device AND not expired
                if (urlDeviceId && parsed.deviceId !== urlDeviceId) {
                    console.log(`🔄 Summary cache device (${parsed.deviceId}) != URL device (${urlDeviceId}), clearing`);
                    localStorage.removeItem(LS_CACHE_KEYS.summaryData);
                } else if (age < LIGHTEARTH_CACHE_TTL) {
                    console.log(`📦 Loaded Summary cache from localStorage (age: ${Math.round(age / 1000)}s, device: ${parsed.deviceId})`);
                    summaryDataCache = parsed;
                } else {
                    console.log('⚠️ Summary cache expired, clearing');
                    localStorage.removeItem(LS_CACHE_KEYS.summaryData);
                }
            }
        } catch (e) {
            console.warn('Failed to load cache from localStorage:', e);
        }
    }

    // Save cache to localStorage
    function saveCacheToLocalStorage() {
        try {
            if (lightearthCache.data) {
                localStorage.setItem(LS_CACHE_KEYS.lightearthData, JSON.stringify(lightearthCache));
                console.log(`💾 Chart cache saved to localStorage (device: ${lightearthCache.deviceId})`);
            }
        } catch (e) {
            console.warn('Failed to save cache to localStorage:', e);
        }
    }

    // Save summary cache to localStorage
    function saveSummaryCacheToLocalStorage() {
        try {
            if (summaryDataCache.data) {
                localStorage.setItem(LS_CACHE_KEYS.summaryData, JSON.stringify(summaryDataCache));
                console.log(`💾 Summary cache saved to localStorage (device: ${summaryDataCache.deviceId})`);
            }
        } catch (e) {
            console.warn('Failed to save summary cache to localStorage:', e);
        }
    }

    // Cache for summary data per device (persists until device changes)
    // IMPORTANT: Must be defined BEFORE loadCacheFromLocalStorage() is called
    let summaryDataCache = {
        deviceId: null,
        data: null,
        timestamp: 0
    };

    // Initialize cache from localStorage AFTER summaryDataCache is defined
    loadCacheFromLocalStorage();

    // Default to Local API with LightEarth Cloud
    let currentApiSource = 'local';

    function getRealtimeApiUrl(deviceId) {
        // Use Cloudflare Worker for realtime API - 100% FREE (no Railway egress)
        // Automatically use fallback API if primary fails
        const baseUrl = getCurrentWorkerAPI();
        return `${baseUrl}/api/realtime/device/${deviceId}`;
    }

    // SOC API URL - Use Cloudflare Worker (with fallback support)
    function getSocApiUrl(deviceId, date) {
        const baseUrl = getCurrentWorkerTSP();
        return `${baseUrl}/api/realtime/soc-history/${deviceId}?date=${date}`;
    }

    // Power History API URL (with fallback support)
    function getPowerHistoryApiUrl(deviceId, date) {
        const baseUrl = getCurrentWorkerTSP();
        return `${baseUrl}/api/realtime/power-history/${deviceId}?date=${date}`;
    }

    // Store previous values for blink detection
    // previousValues is now declared at top level to avoid TDZ
    let previousCellValues = {};
    let lastCellUpdateTime = 0;

    // Battery cell communication state
    let hasCellData = false; // True only after receiving REAL data from system
    let cellDataReceived = false; // Flag to track if we ever received cell data

    // Realtime polling interval
    let realtimePollingInterval = null;

    // ========================================
    // EVENT LISTENERS
    // ========================================

    // View button
    const viewBtn = document.getElementById('viewBtn');
    if (viewBtn) {
        viewBtn.addEventListener('click', fetchData);
    }

    // Date navigation
    const prevDayBtn = document.getElementById('prevDay');
    const nextDayBtn = document.getElementById('nextDay');
    if (prevDayBtn) prevDayBtn.addEventListener('click', () => changeDate(-1));
    if (nextDayBtn) nextDayBtn.addEventListener('click', () => changeDate(1));

    // Summary card clicks - scroll to section
    const cardSections = [
        { cardId: 'pv-card', sectionId: 'pv-section' },
        { cardId: 'bat-charge-card', sectionId: 'bat-section' },
        { cardId: 'bat-discharge-card', sectionId: 'bat-section' },
        { cardId: 'load-card', sectionId: 'load-section' },
        { cardId: 'grid-card', sectionId: 'grid-section' },
        { cardId: 'essential-card', sectionId: 'essential-section' }
    ];

    cardSections.forEach(({ cardId, sectionId }) => {
        const card = document.getElementById(cardId);
        if (card) {
            card.addEventListener('click', () => scrollToElement(sectionId));
        }
    });

    // Hero section toggle (mobile)
    const heroToggle = document.getElementById('heroToggle');
    const heroContent = document.getElementById('heroContent');
    if (heroToggle && heroContent) {
        heroToggle.addEventListener('click', () => {
            heroContent.classList.toggle('collapsed');
            heroToggle.classList.toggle('rotated');
        });
    }

    // Battery cell section toggle
    const cellSectionHeader = document.getElementById('cellSectionHeader');
    const cellSectionContent = document.getElementById('cellSectionContent');
    const toggleIcon = document.getElementById('toggleIcon');
    const toggleText = document.getElementById('toggleText');

    if (cellSectionHeader && cellSectionContent) {
        cellSectionHeader.addEventListener('click', (e) => {
            // Ignore if clicking on reload button
            if (e.target.closest('#reloadCellBtn')) return;

            const isCollapsed = cellSectionContent.classList.toggle('hidden');
            if (toggleIcon) {
                toggleIcon.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
            }
            if (toggleText) {
                toggleText.textContent = isCollapsed ? 'Hiện' : 'Ẩn';
            }
        });
    }

    // Reload cell data button
    const reloadCellBtn = document.getElementById('reloadCellBtn');
    if (reloadCellBtn) {
        reloadCellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            requestCellDataReload();
        });
    }

    // Change device button - show hero section again
    const changeDeviceBtn = document.getElementById('changeDeviceBtn');
    if (changeDeviceBtn) {
        changeDeviceBtn.addEventListener('click', () => {
            const heroSection = document.getElementById('heroSection');
            const compactSearch = document.getElementById('compactSearch');

            if (heroSection) {
                heroSection.classList.remove('hidden');
            }
            if (compactSearch) {
                compactSearch.classList.add('hidden');
            }
            // Focus on device ID input
            const deviceIdInput = document.getElementById('deviceId');
            if (deviceIdInput) {
                deviceIdInput.focus();
                deviceIdInput.select();
            }
        });
    }

    // Compact date navigation
    const prevDayCompact = document.getElementById('prevDayCompact');
    const nextDayCompact = document.getElementById('nextDayCompact');
    if (prevDayCompact) prevDayCompact.addEventListener('click', () => changeDate(-1));
    if (nextDayCompact) nextDayCompact.addEventListener('click', () => changeDate(1));

    // Compact date picker - allows selecting specific date
    const compactDateInput = document.getElementById('compactDateInput');
    if (compactDateInput) {
        compactDateInput.addEventListener('change', function () {
            const selectedDate = this.value;
            if (selectedDate) {
                // Update main date input
                const mainDateInput = document.getElementById('dateInput');
                if (mainDateInput) {
                    mainDateInput.value = selectedDate;
                }
                // Update compact date display
                const compactDateDisplay = document.getElementById('compactDateDisplay');
                if (compactDateDisplay) {
                    const dateObj = new Date(selectedDate);
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const year = dateObj.getFullYear();
                    compactDateDisplay.textContent = `${day}/${month}/${year}`;

                    // Show date change notification
                    showDateChangeNotification(`${day}/${month}/${year}`);
                }
                // Fetch data for new date (skip device notification)
                window.skipDeviceNotification = true;
                fetchData();
            }
        });
    }

    // Initialize SignalR
    initializeSignalRConnection();

    // Auto-fetch if deviceId in URL
    if (deviceIdParam) {
        fetchData();
    }

    // ========================================
    // CHART CONFIGURATION
    // ========================================

    function configureChartDefaults() {
        Chart.defaults.font.family = "'Inter', 'Segoe UI', 'Helvetica', 'Arial', sans-serif";
        Chart.defaults.color = '#64748b';
        Chart.defaults.elements.line.borderWidth = 2;
        Chart.defaults.elements.point.hitRadius = 8;

        const isDarkMode = document.documentElement.classList.contains('dark') ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        Chart.defaults.scale.grid.color = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        Chart.defaults.scale.ticks.color = isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)';

        // Register custom tooltip positioner to prevent cutoff at chart edges
        Chart.Tooltip.positioners.edgeAware = function (elements, eventPosition) {
            if (!elements.length) return false;

            const chart = this.chart;
            const chartArea = chart.chartArea;
            const tooltipWidth = 140;
            const padding = 20;

            let x = elements[0].element.x;
            let y = elements[0].element.y;

            // Adjust X if tooltip would overflow right edge
            if (x + tooltipWidth / 2 > chartArea.right - padding) {
                x = chartArea.right - tooltipWidth - padding;
            }
            // Adjust X if tooltip would overflow left edge
            if (x - tooltipWidth / 2 < chartArea.left + padding) {
                x = chartArea.left + tooltipWidth / 2 + padding;
            }

            return { x: x, y: y };
        };

        // Fixed top-right corner tooltip positioner - never covers chart data
        Chart.Tooltip.positioners.topRight = function (elements, eventPosition) {
            const chart = this.chart;
            const chartArea = chart.chartArea;

            // Position at fixed top-right corner
            return {
                x: chartArea.right - 10,  // 10px from right edge
                y: chartArea.top + 10     // 10px from top
            };
        };

        // Custom crosshair plugin - draws vertical line from hover point to bottom
        const crosshairPlugin = {
            id: 'crosshair',
            afterDraw: (chart) => {
                if (chart.tooltip._active && chart.tooltip._active.length) {
                    const activePoint = chart.tooltip._active[0];
                    const ctx = chart.ctx;
                    const x = activePoint.element.x;
                    const topY = chart.chartArea.top;
                    const bottomY = chart.chartArea.bottom;

                    // Draw vertical line
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, topY);
                    ctx.lineTo(x, bottomY);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        };

        // Register crosshair plugin globally
        Chart.register(crosshairPlugin);
    }

    // ========================================
    // SIGNALR CONNECTION - DISABLED FOR CLOUDFLARE VERSION
    // Using HTTP polling instead (works without Railway)
    // ========================================

    function initializeSignalRConnection() {
        // CLOUDFLARE VERSION: SignalR disabled - using polling instead
        console.log("🌐 [Cloudflare Mode] SignalR disabled - using HTTP polling (5s interval)");
        updateConnectionStatus('connected', 'http');

        // SignalR not needed - polling handles everything
        // This saves Railway resources and works with static hosting
    }

    function updateConnectionStatus(status, source = 'system') {
        const indicator = document.getElementById('connectionIndicator');
        const text = document.getElementById('connectionText');

        // Track connection status by source
        if (source === 'system') {
            systemConnected = (status === 'connected');
        } else if (source === 'http') {
            httpApiConnected = (status === 'connected');
            if (status === 'connected') {
                lastHttpApiUpdate = Date.now();
            }
        }

        // Determine overall status - HTTP API takes priority if system is down
        let displayStatus = 'disconnected';
        let displayText = 'Mất kết nối';

        if (systemConnected) {
            displayStatus = 'connected';
            displayText = 'Hệ thống: Đã kết nối';
        } else if (httpApiConnected) {
            displayStatus = 'connected';
            displayText = 'HTTP API: Đang hoạt động';
        } else if (status === 'connecting') {
            displayStatus = 'connecting';
            displayText = 'Đang kết nối...';
        }

        if (indicator) {
            indicator.className = 'w-2.5 h-2.5 rounded-full';
            if (displayStatus === 'connected') {
                indicator.classList.add('status-connected');
            } else if (displayStatus === 'connecting') {
                indicator.classList.add('status-connecting');
            } else {
                indicator.classList.add('status-disconnected');
            }
        }

        if (text) {
            text.textContent = displayText;
        }
    }

    async function startSignalRConnection() {
        // CLOUDFLARE VERSION: No SignalR - just start polling
        console.log("🌐 [Cloudflare Mode] Starting HTTP polling instead of SignalR");
        updateConnectionStatus('connected', 'http');

        let deviceToSubscribe = document.getElementById('deviceId')?.value?.trim();
        if (!deviceToSubscribe) {
            deviceToSubscribe = urlParams.get('deviceId');
        }

        if (deviceToSubscribe) {
            subscribeToDevice(deviceToSubscribe);
        }
    }

    function subscribeToDevice(deviceId) {
        if (!deviceId) return;

        // CLOUDFLARE VERSION: Only use polling (no SignalR)
        console.log(`🌐 [Cloudflare Mode] Subscribing to device: ${deviceId} via HTTP polling`);
        currentDeviceId = deviceId;
        startRealtimePolling(deviceId);
    }

    // ========================================
    // REALTIME POLLING (3 seconds interval)
    // ========================================

    function startRealtimePolling(deviceId) {
        if (realtimePollingInterval) {
            clearInterval(realtimePollingInterval);
        }

        const pollingInterval = getCurrentPollingInterval();
        const healthyCount = API_POOL.filter(a => !a.disabled).length;
        console.log(`🔄 Starting realtime polling for device: ${deviceId} (every ${pollingInterval / 1000}s - ${healthyCount}/${API_POOL.length} APIs healthy)`);

        // Fetch immediately
        fetchRealtimeData(deviceId);

        // Poll based on current API state
        // Primary: 5 seconds, Fallback: 10 seconds
        realtimePollingInterval = setInterval(() => {
            fetchRealtimeData(deviceId);
        }, pollingInterval);
    }

    // Restart polling with new interval (legacy - kept for compatibility)
    function restartPollingWithNewInterval(deviceId) {
        if (realtimePollingInterval) {
            clearInterval(realtimePollingInterval);
            const pollingInterval = getCurrentPollingInterval();
            const healthyCount = API_POOL.filter(a => !a.disabled).length;
            console.log(`🔄 Restarting polling (${pollingInterval / 1000}s - ${healthyCount}/${API_POOL.length} APIs healthy)`);
            realtimePollingInterval = setInterval(() => {
                fetchRealtimeData(deviceId);
            }, pollingInterval);
        }
    }

    function stopRealtimePolling() {
        if (realtimePollingInterval) {
            clearInterval(realtimePollingInterval);
            realtimePollingInterval = null;
        }
    }

    async function fetchRealtimeData(deviceId) {
        // Load Balancing: Check if we should rotate to a different API
        let selectedApi = null;

        // If we've hit rotation threshold on current API, switch to random different one
        if (currentApiSuccessCount >= ROTATION_THRESHOLD && lastSuccessfulApiName) {
            console.log(`🔄 Rotation: ${lastSuccessfulApiName} reached ${currentApiSuccessCount} successes, switching...`);
            selectedApi = getRandomHealthyApi(lastSuccessfulApiName);
            currentApiSuccessCount = 0;  // Reset counter
        }

        // Get all healthy APIs to try in order (starting with selected if rotation active)
        let healthyApis = API_POOL.filter(api => !api.disabled);

        if (healthyApis.length === 0) {
            console.warn('⚠️ All APIs disabled, resetting...');
            API_POOL.forEach(api => {
                api.disabled = false;
                api.failCount = 0;
            });
            currentApiSuccessCount = 0;
            lastSuccessfulApiName = null;
            // Try again with reset APIs
            return fetchRealtimeData(deviceId);
        }

        // If we have a selected API from rotation, put it first
        if (selectedApi) {
            healthyApis = [selectedApi, ...healthyApis.filter(a => a.name !== selectedApi.name)];
        } else {
            // Random shuffle Priority 1 APIs for even load distribution
            // Then sort so Priority 1 (shuffled) comes before Priority 2
            const priority1 = healthyApis.filter(a => a.priority === 1);
            const priority2 = healthyApis.filter(a => a.priority === 2);

            // Fisher-Yates shuffle for Priority 1
            for (let i = priority1.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [priority1[i], priority1[j]] = [priority1[j], priority1[i]];
            }

            healthyApis = [...priority1, ...priority2];
            console.log(`🎲 Shuffled API order: ${healthyApis.map(a => a.name.split(' ')[0]).join(' → ')}`);
        }

        let lastError = null;

        // Try each API until one succeeds
        for (let i = 0; i < healthyApis.length; i++) {
            const api = healthyApis[i];
            const apiUrl = `${api.worker}/api/realtime/device/${deviceId}`;
            console.log(`📡 [${i + 1}/${healthyApis.length}] Trying ${api.name}:`, apiUrl);

            try {
                // Real timeout using AbortController (6 seconds - reduced for faster failover)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);

                const response = await fetch(apiUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.error(`❌ API error ${response.status}: ${response.statusText} for ${apiUrl}`);
                    markApiFailed(apiUrl);
                    lastError = new Error(`HTTP ${response.status}`);
                    continue; // Try next API
                }

                // Success - reset fail count for this API
                markApiSuccess(apiUrl);

                // Load Balancing: Track success count for rotation
                if (lastSuccessfulApiName === api.name) {
                    currentApiSuccessCount++;
                } else {
                    // Switched to different API, reset counter
                    currentApiSuccessCount = 1;
                    lastSuccessfulApiName = api.name;
                }
                console.log(`✅ ${api.name} success #${currentApiSuccessCount}/${ROTATION_THRESHOLD}`);

                const data = await response.json();
                console.log('🔍 RAW API Response:', JSON.stringify(data).substring(0, 500));
                console.log('🔍 data.deviceData exists:', data.deviceData !== undefined);
                console.log('🔍 data.deviceData?.battery:', data.deviceData?.battery);
                console.log('🔍 data.deviceData?.battery?.cells:', data.deviceData?.battery?.cells);
                if (data.error) return;

                // Check if device not found in LightEarth Cloud
                if (data.success === false) {
                    console.warn(`⚠️ Device ${deviceId} not found:`, data.message);
                    // Show error message to user
                    updateRealTimeDisplay({
                        noRealtimeData: true,
                        deviceNotFound: true,
                        errorMessage: data.message || `Device ${deviceId} not found in LightEarth Cloud`
                    });
                    return;
                }

                // Detect format: Cloud API has deviceData, Legacy has data
                const isNewFormat = data.deviceData !== undefined;
                let displayData, cellsData;

                if (isNewFormat) {
                    // New format from Cloud API (Cloudflare Worker v3.7)
                    const dd = data.deviceData || {};
                    console.log('🔍 [v13245] dd.battery:', dd.battery);
                    console.log('🔍 [v13245] dd.battery?.cells:', dd.battery?.cells);
                    displayData = {
                        pvTotalPower: dd.pv?.totalPower || 0,
                        pv1Power: dd.pv?.pv1Power || 0,
                        pv2Power: dd.pv?.pv2Power || 0,
                        pv1Voltage: dd.pv?.pv1Voltage || 0,
                        pv2Voltage: dd.pv?.pv2Voltage || 0,
                        gridValue: dd.grid?.power || 0,
                        gridVoltageValue: dd.grid?.inputVoltage || 0,
                        batteryPercent: dd.battery?.soc || 0,
                        batteryValue: dd.battery?.power || 0,
                        batteryVoltage: dd.battery?.voltage || 0,
                        batteryCurrent: dd.battery?.current || 0,
                        batteryStatus: dd.battery?.status || 'Idle',
                        deviceTempValue: dd.temperature || dd.system?.temperature || 0,
                        essentialValue: dd.acOutput?.power || 0,
                        loadValue: dd.load?.homePower || dd.load?.power || 0,
                        inverterAcOutPower: dd.acOutput?.power || 0,
                        // Device model from API
                        model: dd.model || data.deviceData?.model || null
                    };
                    // Battery cells data from Worker v3.9: deviceData.batteryCells
                    cellsData = dd.batteryCells || dd.battery?.cells || data.batteryCells;
                    console.log('📊 [v13245] Using Cloud format (Worker v3.9)', displayData);
                    console.log('🔋 [v13245] batteryCells from API:', cellsData);
                } else if (data.data) {
                    // Legacy format from API
                    displayData = {
                        pvTotalPower: data.data.totalPvPower || 0,
                        pv1Power: data.data.pv1Power || 0,
                        pv2Power: data.data.pv2Power || 0,
                        pv1Voltage: data.data.pv1Voltage || 0,
                        pv2Voltage: data.data.pv2Voltage || 0,
                        gridValue: data.data.gridPowerFlow || 0,
                        gridVoltageValue: data.data.acInputVoltage || 0,
                        batteryPercent: data.data.batterySoc || 0,
                        batteryValue: data.data.batteryPower || 0,
                        batteryVoltage: data.data.batteryVoltage || 0,
                        batteryCurrent: data.data.batteryCurrent || 0,
                        batteryStatus: data.data.batteryStatus || 'Idle',
                        deviceTempValue: data.data.temperature || 0,
                        essentialValue: data.data.acOutputPower || 0,
                        loadValue: data.data.homeLoad || 0,
                        inverterAcOutPower: data.data.acOutputPower || 0
                    };
                    cellsData = data.cells;
                    console.log('📊 Using Legacy format', displayData);
                } else {
                    return; // No valid data
                }

                // Store data for 3D view sync
                latestRealtimeData = displayData;

                // Update displays with realtime data
                updateRealTimeDisplay(displayData);

                // Update device model/type from realtime API data
                if (displayData.model) {
                    applyDeviceInfo(displayData.model);
                }

                // Update battery cell voltages
                console.log('🔋 CellsData received:', cellsData ? 'YES' : 'NO');
                console.log('🔋 CellsData structure:', cellsData);

                // If no cells data from current API, fetch from lightearth-proxy (which always has cells)
                if (!cellsData || !cellsData.cells) {
                    console.log('🔋 No cells in current API response, fetching from lightearth-proxy...');
                    fetchBatteryCellsFromProxy(deviceId);
                }

                // Handle multiple cell data formats
                let cellVoltages = [];
                let maxVoltage = 0, minVoltage = 0, avgVoltage = 0;

                if (cellsData) {
                    // Format 1: Worker v3.9 - {num, avg, min, max, diff, cells: [{cell: 1, voltage: 3.352}, ...]}
                    if (cellsData.cells && Array.isArray(cellsData.cells)) {
                        console.log('✅ Processing Worker v3.9 format (cells array of objects)');
                        console.log('🔋 Raw cellsData.cells:', JSON.stringify(cellsData.cells));
                        // Sort by cell number and extract voltages
                        const sortedCells = [...cellsData.cells].sort((a, b) => a.cell - b.cell);
                        sortedCells.forEach((cellObj, index) => {
                            const voltage = cellObj.voltage;
                            cellVoltages.push(voltage);
                            console.log(`🔋 Cell ${cellObj.cell}: ${voltage}V`);
                        });
                        maxVoltage = cellsData.max || 0;
                        minVoltage = cellsData.min || 0;
                        avgVoltage = cellsData.avg || 0;
                        console.log('🔋 Final cellVoltages array:', cellVoltages);
                    }
                    // Format 2: Worker v3.7 - {num, avg, min, max, diff, cells: {c_01: 3.181, ...}}
                    else if (cellsData.cells && typeof cellsData.cells === 'object' && !Array.isArray(cellsData.cells)) {
                        console.log('✅ Processing Worker v3.7 format (cells object)');
                        console.log('🔋 Raw cellsData.cells:', JSON.stringify(cellsData.cells));
                        const cellKeys = Object.keys(cellsData.cells).sort((a, b) => {
                            const numA = parseInt(a.replace(/\D/g, ''));
                            const numB = parseInt(b.replace(/\D/g, ''));
                            return numA - numB;
                        });
                        console.log('🔋 Sorted cellKeys:', cellKeys);
                        cellKeys.forEach((key, index) => {
                            const voltage = cellsData.cells[key];
                            cellVoltages.push(voltage);
                            console.log(`🔋 Cell ${index + 1} (${key}): ${voltage}V`);
                        });
                        maxVoltage = cellsData.max || 0;
                        minVoltage = cellsData.min || 0;
                        avgVoltage = cellsData.avg || 0;
                        console.log('🔋 Final cellVoltages array:', cellVoltages);
                    }
                    // Format 3: Legacy - {cellVoltages: [3.413, 3.379, ...]}
                    else if (cellsData.cellVoltages) {
                        console.log('✅ Processing Legacy format (cellVoltages array)');
                        const rawVoltages = cellsData.cellVoltages;
                        if (Array.isArray(rawVoltages)) {
                            cellVoltages = rawVoltages;
                        } else if (typeof rawVoltages === 'object') {
                            const cellNames = Object.keys(rawVoltages).sort((a, b) =>
                                parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, ''))
                            );
                            cellNames.forEach(cellName => {
                                cellVoltages.push(rawVoltages[cellName]);
                            });
                        }
                        maxVoltage = cellsData.maximumVoltage || 0;
                        minVoltage = cellsData.minimumVoltage || 0;
                        avgVoltage = cellsData.averageVoltage || 0;
                    }

                    if (cellVoltages.length > 0) {
                        const validVoltages = cellVoltages.filter(v => v > 0);
                        const cellData = {
                            cells: cellVoltages,
                            maximumVoltage: maxVoltage || Math.max(...validVoltages, 0),
                            minimumVoltage: minVoltage || Math.min(...validVoltages.filter(v => v > 0), 0),
                            averageVoltage: avgVoltage || (validVoltages.length > 0 ? validVoltages.reduce((a, b) => a + b, 0) / validVoltages.length : 0),
                            numberOfCells: cellVoltages.length
                        };
                        updateBatteryCellDisplay(cellData);
                        console.log(`📊 Cell voltages updated: ${cellVoltages.length} cells`, cellData);
                    }
                }

                // NOTE: SOC data is handled by fetchSOCData() from API
                // Chart data is loaded only once in fetchData()

                updateConnectionStatus('connected', 'http');
                return; // Success - exit the function
            } catch (error) {
                console.error(`❌ Network error for ${api.name}:`, error.message);
                markApiFailed(apiUrl);
                lastError = error;
                continue; // Try next API
            }
        }

        // All APIs failed
        console.error('❌ All APIs failed! Last error:', lastError?.message);
        updateConnectionStatus('disconnected', 'http');
    }

    // CLOUDFLARE VERSION: SignalR disabled - connection.onclose not needed
    // connection.onclose is removed because we use HTTP polling instead
    // If SignalR were enabled, it would be:
    // connection.onclose(async () => {
    //     console.log("SignalR connection closed");
    //     updateConnectionStatus('disconnected', 'system');
    //     await startSignalRConnection();
    // });

    // ========================================
    // DATA FETCHING
    // ========================================

    // ========================================
    // AUTO DEVICE REGISTRATION (NEW!)
    // Check if device exists in HA, if not - auto-register via MQTT Discovery
    // ========================================

    // Cache for device existence checks (avoid repeated API calls)
    const deviceExistsCache = new Map();
    const DEVICE_CHECK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Check if device exists in Lumentree Integration (Home Assistant)
     * Uses Worker v3.1 API to check both Integration and MQTT Discovery
     * @param {string} deviceId - Device ID to check
     * @returns {Promise<{exists: boolean, entityCount: number, inLumentreeIntegration: boolean}>}
     */
    async function checkDeviceInHA(deviceId) {
        const normalizedId = deviceId.toUpperCase();

        // Check cache first
        const cached = deviceExistsCache.get(normalizedId);
        if (cached && (Date.now() - cached.timestamp) < DEVICE_CHECK_CACHE_TTL) {
            console.log(`📦 [Device Check] Cache hit for ${normalizedId}: exists=${cached.exists}`);
            return cached;
        }

        try {
            const response = await fetch(`${DEVICE_REGISTER_WORKER}/check/${normalizedId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // v3.1 API returns: inLumentreeIntegration, entityCount.integrationCount, etc.
            const inIntegration = data.inLumentreeIntegration || false;
            const entityCount = data.entityCount?.integrationCount || data.entityCount?.totalCount || 0;

            const result = {
                exists: inIntegration,
                entityCount: entityCount,
                inLumentreeIntegration: inIntegration,
                inMqttDiscovery: data.inMqttDiscovery || false,
                timestamp: Date.now()
            };

            // Cache the result
            deviceExistsCache.set(normalizedId, result);
            console.log(`🔍 [Device Check] ${normalizedId}: inLumentree=${inIntegration}, entities=${entityCount}`);

            return result;
        } catch (error) {
            console.warn(`⚠️ [Device Check] Failed for ${normalizedId}:`, error.message);
            // On error, assume device exists (don't block user)
            return { exists: true, entityCount: -1, error: error.message };
        }
    }

    /**
     * Request device registration with Telegram approval flow (v4.2)
     * Sends notification to admin, waits for approval before registering
     * @param {string} deviceId - Device ID to register
     * @returns {Promise<{success: boolean, status: string, message: string}>}
     */
    async function autoRegisterDevice(deviceId) {
        const normalizedId = deviceId.toUpperCase();
        console.log(`🔧 [Device Request] Requesting device: ${normalizedId} (Telegram approval flow v4.2)`);

        try {
            // Use /request-device endpoint (v4.2 API) - triggers Telegram notification
            const response = await fetch(`${DEVICE_REGISTER_WORKER}/request-device`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: normalizedId,
                    source: 'LightEarth Dashboard',
                    userInfo: 'Web User'
                })
            });

            const data = await response.json();
            console.log('📩 [Request Device] API Response:', data);

            // Handle different statuses:
            // - pending_approval: New request, waiting for admin
            // - already_exists: Device already in HA
            // - already_pending: Request already submitted

            if (data.status === 'already_exists') {
                // Device already exists - show info and continue
                console.log(`✅ [Request Device] ${normalizedId} already exists in HA`);
                showDeviceRegistrationNotification(normalizedId, 51, true);
                return { success: true, message: 'Device already exists', alreadyExists: true };
            }

            if (data.status === 'pending_approval' || data.status === 'already_pending') {
                // New request or already pending - show countdown UI
                console.log(`⏳ [Request Device] ${normalizedId} pending approval - Telegram sent: ${data.telegramSent}`);

                // Show countdown notification (5 minutes)
                showPendingApprovalUI(normalizedId);

                return { success: true, status: 'pending_approval', message: data.message, waitForApproval: true };
            }

            // Handle errors
            if (!data.success && data.error) {
                console.error(`❌ [Request Device] Failed:`, data.error);
                showErrorNotification(`Không thể gửi yêu cầu ${normalizedId}: ${data.error}`);
                return { success: false, message: data.error };
            }

            return { success: true, message: data.message || 'Request submitted' };
        } catch (error) {
            console.error(`❌ [Request Device] Error:`, error.message);
            return { success: false, message: error.message };
        }
    }

    /**
     * Show pending approval UI with 5-minute countdown
     * Auto-checks status every 5 seconds and auto-reloads when approved
     * @param {string} deviceId - Device ID being registered
     */
    function showPendingApprovalUI(deviceId) {
        // Remove any existing pending UI
        const existingUI = document.getElementById('pending-approval-modal');
        if (existingUI) existingUI.remove();

        // Create modal overlay
        const modal = document.createElement('div');
        modal.id = 'pending-approval-modal';
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm';

        // Calculate countdown (5 minutes = 300 seconds)
        let remainingSeconds = 300;
        let statusCheckInterval = null;

        modal.innerHTML = `
            <div class="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 sm:p-8 max-w-md mx-4 shadow-2xl border border-slate-600">
                <!-- Header - Waiting State -->
                <div id="pending-waiting-state" class="text-center mb-6">
                    <div class="w-20 h-20 mx-auto mb-4 relative">
                        <div class="absolute inset-0 rounded-full border-4 border-amber-400/30"></div>
                        <div id="countdown-circle" class="absolute inset-0 rounded-full border-4 border-amber-400" 
                             style="border-top-color: transparent; animation: spin 1.5s linear infinite;"></div>
                        <div class="absolute inset-0 flex items-center justify-center">
                            <span class="text-3xl">⏳</span>
                        </div>
                    </div>
                    <h2 class="text-xl font-bold text-white mb-1">Đang Chờ Duyệt</h2>
                    <p class="text-slate-400 text-sm">Yêu cầu đã gửi đến admin</p>
                </div>
                
                <!-- Header - Approved State (Hidden initially) -->
                <div id="pending-approved-state" class="text-center mb-6 hidden">
                    <div class="w-20 h-20 mx-auto mb-4 relative">
                        <div class="absolute inset-0 rounded-full bg-emerald-500/20 flex items-center justify-center" style="animation: pulse 1s ease-out;">
                            <span class="text-5xl">✅</span>
                        </div>
                    </div>
                    <h2 class="text-xl font-bold text-emerald-400 mb-1">Đã Được Duyệt!</h2>
                    <p class="text-slate-400 text-sm">Thiết bị đã được thêm vào hệ thống</p>
                    <p id="approved-by-text" class="text-emerald-400 text-sm mt-1"></p>
                </div>
                
                <!-- Header - Rejected State (Hidden initially) -->
                <div id="pending-rejected-state" class="text-center mb-6 hidden">
                    <div class="w-20 h-20 mx-auto mb-4 relative">
                        <div class="absolute inset-0 rounded-full bg-red-500/20 flex items-center justify-center">
                            <span class="text-5xl">❌</span>
                        </div>
                    </div>
                    <h2 class="text-xl font-bold text-red-400 mb-1">Đã Bị Từ Chối</h2>
                    <p class="text-slate-400 text-sm">Yêu cầu không được chấp nhận</p>
                    <p id="rejected-by-text" class="text-red-400 text-sm mt-1"></p>
                </div>
                
                <!-- Device Info -->
                <div class="bg-slate-700/50 rounded-xl p-4 mb-4">
                    <div class="flex items-center justify-between">
                        <span class="text-slate-400">Device ID:</span>
                        <span class="font-mono font-bold text-amber-400">${deviceId}</span>
                    </div>
                </div>
                
                <!-- Countdown (shown when waiting) -->
                <div id="countdown-section" class="text-center mb-6">
                    <p class="text-slate-400 text-sm mb-2">Thời gian chờ dự kiến:</p>
                    <div id="countdown-display" class="text-4xl font-bold text-emerald-400">
                        05:00
                    </div>
                    <p class="text-slate-500 text-xs mt-2">Tự động kiểm tra mỗi 5 giây...</p>
                </div>
                
                <!-- Auto-reload message (shown when approved/rejected) -->
                <div id="auto-reload-section" class="text-center mb-6 hidden">
                    <p class="text-slate-400 text-sm">Trang sẽ tự động reload sau <span id="reload-countdown" class="text-emerald-400 font-bold">3</span> giây...</p>
                </div>
                
                <!-- Zalo Group CTA -->
                <div id="zalo-cta" class="bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl p-4 mb-4">
                    <p class="text-white text-sm mb-3 text-center">
                        🔔 <strong>Tham gia nhóm Zalo</strong> để được cập nhật nhanh!
                    </p>
                    <a href="https://zalo.me/g/kmzrgh433" target="_blank" rel="noopener noreferrer"
                       class="flex items-center justify-center gap-2 bg-white text-blue-600 font-bold py-3 px-4 rounded-lg hover:bg-blue-50 transition-colors">
                        <img src="/zalo-logo.png" alt="Zalo" class="w-6 h-6" onerror="this.style.display='none'">
                        <span>Tham gia Zalo LightEarth VN</span>
                    </a>
                </div>
                
                <!-- Actions -->
                <div id="action-buttons" class="flex gap-3">
                    <button id="cancel-pending-btn" 
                            class="flex-1 py-3 px-4 rounded-lg bg-slate-700 text-slate-300 font-medium hover:bg-slate-600 transition-colors">
                        Hủy
                    </button>
                    <button id="reload-btn" 
                            class="flex-1 py-3 px-4 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition-colors">
                        <i class="fas fa-redo mr-2"></i>Reload
                    </button>
                </div>
            </div>
            
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes pulse {
                    0% { transform: scale(0.8); opacity: 0; }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); opacity: 1; }
                }
            </style>
        `;

        document.body.appendChild(modal);

        // Get elements
        const countdownDisplay = document.getElementById('countdown-display');
        const waitingState = document.getElementById('pending-waiting-state');
        const approvedState = document.getElementById('pending-approved-state');
        const rejectedState = document.getElementById('pending-rejected-state');
        const countdownSection = document.getElementById('countdown-section');
        const autoReloadSection = document.getElementById('auto-reload-section');
        const zaloCta = document.getElementById('zalo-cta');
        const actionButtons = document.getElementById('action-buttons');

        // Function to check approval status
        async function checkApprovalStatus() {
            try {
                const response = await fetch(`${DEVICE_REGISTER_WORKER}/check/${deviceId}`);
                const data = await response.json();

                console.log('[Auto Check] Status:', data);

                // Check if APPROVED (either in integration OR approvalInfo shows approved)
                if (data.inIntegration || data.inLumentreeIntegration ||
                    (data.approvalInfo && data.approvalInfo.status === 'approved')) {

                    // APPROVED! Show approved state
                    clearAllIntervals();
                    showApprovedUI(data.approvalInfo?.approvedBy || data.approvedBy || 'Admin');
                    return true;
                }

                // Check if REJECTED
                if (data.pendingStatus === 'rejected' ||
                    (data.approvalInfo && data.approvalInfo.status === 'rejected')) {

                    // REJECTED! Show rejected state
                    clearAllIntervals();
                    showRejectedUI(data.approvalInfo?.rejectedBy || data.rejectedBy || 'Admin');
                    return true;
                }

                return false; // Still pending
            } catch (error) {
                console.error('[Auto Check] Error:', error);
                return false;
            }
        }

        // Function to show approved UI
        function showApprovedUI(approvedBy) {
            waitingState.classList.add('hidden');
            rejectedState.classList.add('hidden');
            approvedState.classList.remove('hidden');

            document.getElementById('approved-by-text').textContent = `Approved by: ${approvedBy}`;

            countdownSection.classList.add('hidden');
            autoReloadSection.classList.remove('hidden');
            zaloCta.classList.add('hidden');
            actionButtons.classList.add('hidden');

            // Auto reload countdown
            let reloadCountdown = 3;
            const reloadCountdownEl = document.getElementById('reload-countdown');
            const reloadInterval = setInterval(() => {
                reloadCountdown--;
                reloadCountdownEl.textContent = reloadCountdown;
                if (reloadCountdown <= 0) {
                    clearInterval(reloadInterval);
                    window.location.reload();
                }
            }, 1000);
        }

        // Function to show rejected UI
        function showRejectedUI(rejectedBy) {
            waitingState.classList.add('hidden');
            approvedState.classList.add('hidden');
            rejectedState.classList.remove('hidden');

            document.getElementById('rejected-by-text').textContent = `Rejected by: ${rejectedBy}`;

            countdownSection.classList.add('hidden');
            autoReloadSection.classList.remove('hidden');
            autoReloadSection.querySelector('p').innerHTML =
                `Trang sẽ tự động reload sau <span id="reload-countdown" class="text-red-400 font-bold">5</span> giây...`;
            zaloCta.classList.add('hidden');
            actionButtons.classList.add('hidden');

            // Auto reload countdown (longer for rejected)
            let reloadCountdown = 5;
            const reloadCountdownEl = document.getElementById('reload-countdown');
            const reloadInterval = setInterval(() => {
                reloadCountdown--;
                reloadCountdownEl.textContent = reloadCountdown;
                if (reloadCountdown <= 0) {
                    clearInterval(reloadInterval);
                    window.location.reload();
                }
            }, 1000);
        }

        // Function to clear all intervals
        function clearAllIntervals() {
            if (statusCheckInterval) {
                clearInterval(statusCheckInterval);
                statusCheckInterval = null;
            }
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }
        }

        // Start countdown timer
        const countdownInterval = setInterval(() => {
            remainingSeconds--;

            if (remainingSeconds <= 0) {
                clearInterval(countdownInterval);
                countdownDisplay.textContent = '00:00';
                countdownDisplay.classList.remove('text-emerald-400');
                countdownDisplay.classList.add('text-amber-400');
            } else {
                const minutes = Math.floor(remainingSeconds / 60);
                const seconds = remainingSeconds % 60;
                countdownDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
        }, 1000);

        // Start auto-checking status every 5 seconds
        checkApprovalStatus(); // Check immediately
        statusCheckInterval = setInterval(checkApprovalStatus, 5000);

        // Event listeners
        document.getElementById('cancel-pending-btn').addEventListener('click', () => {
            clearAllIntervals();
            modal.remove();
        });

        document.getElementById('reload-btn').addEventListener('click', () => {
            clearAllIntervals();
            window.location.reload();
        });
    }

    /**
     * Show error notification
     */
    function showErrorNotification(message) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg bg-red-500 text-white text-sm font-medium transition-all duration-300';
        toast.innerHTML = `<span class="mr-2">❌</span> ${message}`;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Show notification when device is registered
     */
    function showDeviceRegistrationNotification(deviceId, sensorCount, alreadyExists) {
        // Skip notification if just switching dates
        if (window.skipDeviceNotification) {
            window.skipDeviceNotification = false;
            return;
        }

        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all duration-300';

        if (alreadyExists) {
            toast.classList.add('bg-blue-500');
            toast.innerHTML = `<span class="mr-2">ℹ️</span> Thiết bị ${deviceId} đã có trong hệ thống`;
        } else {
            toast.classList.add('bg-green-500');
            toast.innerHTML = `<span class="mr-2">✅</span> Đã đăng ký ${deviceId} - Tạo ${sensorCount} sensors`;
        }

        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        // Remove after 4 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    /**
     * Show notification when switching dates
     */
    function showDateChangeNotification(dateStr) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all duration-300 bg-teal-500';
        toast.innerHTML = `<span class="mr-2">📅</span> Đang xem ngày ${dateStr}`;
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';

        document.body.appendChild(toast);

        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        // Remove after 2 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    /**
     * Check if device exists in LightEarth Cloud (source of truth)
     * This checks the actual cloud API where devices send their data
     * @param {string} deviceId - Device ID to check
     * @returns {Promise<{exists: boolean, data?: object}>}
     */
    async function checkDeviceInLightEarthCloud(deviceId) {
        const normalizedId = deviceId.toUpperCase();

        try {
            // Try main API first
            const response = await fetch(`${CLOUDFLARE_WORKER}/api/realtime/device/${normalizedId}`, {
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });

            if (!response.ok) {
                console.warn(`⚠️ [Cloud Check] HTTP ${response.status} for ${normalizedId}`);
                return { exists: false };
            }

            const data = await response.json();

            // Check if device was found (success: true means device exists)
            if (data.success === true) {
                console.log(`✅ [Cloud Check] ${normalizedId} found in LightEarth Cloud`);
                return { exists: true, data: data };
            }

            // Device not found in cloud
            console.log(`❌ [Cloud Check] ${normalizedId} not found: ${data.message}`);
            return { exists: false, message: data.message };

        } catch (error) {
            console.warn(`⚠️ [Cloud Check] Error for ${normalizedId}:`, error.message);
            // On timeout or network error, allow user to continue (don't block)
            // They might have connectivity issues but device is valid
            return { exists: true, error: error.message, allowContinue: true };
        }
    }

    /**
     * Check if device has MQTT data (exists in MQTT broker)
     * This is used to validate if device ID is real before registering
     * @param {string} deviceId - Device ID to check
     * @returns {Promise<boolean>} - true if device has MQTT data
     */
    async function checkDeviceHasMqttData(deviceId) {
        const normalizedId = deviceId.toUpperCase();

        try {
            const response = await fetch(`${DEVICE_REGISTER_WORKER}/has-mqtt-data/${normalizedId}`);
            if (!response.ok) {
                console.warn(`⚠️ [MQTT Check] HTTP ${response.status} for ${normalizedId}`);
                return false;
            }

            const data = await response.json();
            console.log(`🔍 [MQTT Check] ${normalizedId}: hasData=${data.hasData}`);
            return data.hasData === true;
        } catch (error) {
            console.warn(`⚠️ [MQTT Check] Error for ${normalizedId}:`, error.message);
            // On error, return false to be safe (don't register unknown devices)
            return false;
        }
    }

    /**
     * Show error when device doesn't exist in system
     */
    function showDeviceNotFoundError(deviceId) {
        // Hide loading
        showLoading(false);

        // Show error message
        showError(`❌ Thiết bị ${deviceId} không tồn tại trong hệ thống!

Vui lòng kiểm tra lại:
• Device ID có đúng không? (VD: H250325151, P250801055)
• Thiết bị đã được kết nối và bật chưa?
• Thiết bị đã được cấu hình MQTT chưa?`);

        // Also show toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg bg-red-600 text-white text-sm font-medium';
        toast.innerHTML = `<span class="mr-2">❌</span> Device ${deviceId} không tồn tại trong hệ thống`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Show warning when registration fails but allow continue
     */
    function showRegistrationWarning(deviceId, reason) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg bg-yellow-500 text-white text-sm font-medium max-w-sm text-center';
        toast.innerHTML = `
            <div class="flex flex-col gap-1">
                <span>⚠️ Không thể đăng ký tự động ${deviceId}</span>
                <span class="text-xs opacity-80">${reason || 'Vui lòng thêm thủ công trong Home Assistant'}</span>
            </div>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    }

    /**
     * Verify device has data after registration
     * Wait up to 15 seconds for data to appear
     * @returns {Promise<boolean>} - true if device has valid data
     */
    async function verifyDeviceHasDataAfterRegistration(deviceId, entryId) {
        const normalizedId = deviceId.toUpperCase();
        const maxWaitTime = 15000; // 15 seconds max
        const checkInterval = 3000; // Check every 3 seconds
        const startTime = Date.now();

        console.log(`🔍 [Verify] Checking data for ${normalizedId} (max ${maxWaitTime / 1000}s)...`);

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // Check via device-register worker
                const response = await fetch(`${DEVICE_REGISTER_WORKER}/has-mqtt-data/${normalizedId}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.hasData === true) {
                        console.log(`✅ [Verify] ${normalizedId} has data!`);
                        return true;
                    }
                    console.log(`⏳ [Verify] ${normalizedId} no data yet, waiting...`);
                }
            } catch (error) {
                console.warn(`⚠️ [Verify] Error checking ${normalizedId}:`, error.message);
            }

            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        console.log(`❌ [Verify] ${normalizedId} timeout - no data received in ${maxWaitTime / 1000}s`);
        return false;
    }

    /**
     * Remove invalid device from Lumentree Integration
     */
    async function removeInvalidDevice(deviceId, entryId) {
        const normalizedId = deviceId.toUpperCase();

        try {
            console.log(`🗑️ [Remove] Removing invalid device ${normalizedId}...`);

            const response = await fetch(`${DEVICE_REGISTER_WORKER}/remove-entry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: normalizedId, entryId: entryId })
            });

            if (response.ok) {
                const data = await response.json();
                console.log(`✅ [Remove] Device ${normalizedId} removed:`, data);
                return true;
            } else {
                console.warn(`⚠️ [Remove] Failed to remove ${normalizedId}: HTTP ${response.status}`);
                return false;
            }
        } catch (error) {
            console.error(`❌ [Remove] Error removing ${normalizedId}:`, error.message);
            return false;
        }
    }

    /**
     * Show error when device is invalid (registered but no data)
     */
    function showInvalidDeviceError(deviceId) {
        showLoading(false);

        showError(`❌ Thiết bị ${deviceId} không hợp lệ!

Thiết bị đã được đăng ký nhưng không nhận được dữ liệu.

Vui lòng kiểm tra:
• Device ID có đúng chữ cái đầu không? (H hoặc P)
• VD: H240911164 ≠ P240911164
• Thiết bị có đang hoạt động và kết nối mạng không?`);

        // Toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg bg-red-600 text-white text-sm font-medium';
        toast.innerHTML = `<span class="mr-2">❌</span> Device ${deviceId} không hợp lệ - đã xóa khỏi hệ thống`;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    }

    // Global reference for waiting notification
    let waitingNotificationEl = null;

    /**
     * Show waiting notification while connecting new device
     */
    function showWaitingNotification(deviceId, message) {
        // Remove existing if any
        hideWaitingNotification();

        waitingNotificationEl = document.createElement('div');
        waitingNotificationEl.id = 'waiting-notification';
        waitingNotificationEl.className = 'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[100] px-6 py-4 rounded-xl shadow-2xl bg-gray-800 border border-gray-600 text-white text-center';
        waitingNotificationEl.innerHTML = `
            <div class="flex flex-col items-center gap-3">
                <div class="animate-spin w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full"></div>
                <div class="text-lg font-semibold">🔗 ${deviceId}</div>
                <div class="text-sm text-gray-300">${message}</div>
            </div>
        `;

        document.body.appendChild(waitingNotificationEl);
    }

    /**
     * Hide waiting notification
     */
    function hideWaitingNotification() {
        if (waitingNotificationEl) {
            waitingNotificationEl.remove();
            waitingNotificationEl = null;
        }
        // Also try to find by ID (in case reference was lost)
        const el = document.getElementById('waiting-notification');
        if (el) el.remove();
    }

    /**
     * Validate Device ID format: H or P followed by 9 digits
     * Examples: H250325151, P250801055
     */
    function validateDeviceId(deviceId) {
        const pattern = /^[HP]\d{9}$/i;
        return pattern.test(deviceId);
    }

    function fetchData() {
        const deviceId = document.getElementById('deviceId')?.value?.trim();
        const date = document.getElementById('dateInput')?.value;

        if (!deviceId) {
            showError('Vui lòng nhập Device ID');
            return;
        }

        // Validate Device ID format: H/P + 9 digits
        if (!validateDeviceId(deviceId)) {
            showError('❌ Device ID không hợp lệ!\n\nĐịnh dạng đúng: H hoặc P + 9 số\nVí dụ: H250325151 hoặc P250801055');
            return;
        }

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('deviceId', deviceId);
        window.history.pushState({}, '', url);

        // Update title
        document.title = `Solar Monitor - ${deviceId}`;

        // Subscribe to real-time
        subscribeToDevice(deviceId);

        showLoading(true);
        hideError();

        // Reset cell data state for new device/refresh
        hasCellData = false;
        cellDataReceived = false;
        previousCellValues = {};
        console.log('🔄 Reset cell data state for device:', deviceId);

        // FAST LOAD: Call realtime API first for instant display
        fetchRealtimeFirst(deviceId, date);
    }

    // Fast load: Optimized data loading with minimal API calls
    async function fetchRealtimeFirst(deviceId, date) {
        console.log(`🚀 Loading data for device: ${deviceId}, date: ${date || 'today'}`);

        // ========================================
        // AUTO DEVICE REGISTRATION CHECK (V4.2 - Telegram Approval Flow)
        // 1. Check if device exists in Lumentree Integration
        // 2. If not, send request via Telegram (admin must approve)
        // 3. Device will only be added after admin clicks ACCEPT
        // 
        // NOTE: We trust format validation (H/P + 9 digits)
        // New devices won't have data until approved and registered
        // ========================================
        try {
            const deviceCheck = await checkDeviceInHA(deviceId);

            if (!deviceCheck.exists && !deviceCheck.error) {
                console.log(`🆕 [New Device] ${deviceId} not found in Lumentree Integration - requesting approval...`);

                // Request device via Telegram approval flow (v4.2)
                const registerResult = await autoRegisterDevice(deviceId);

                // If waiting for approval, stop here - don't load data
                if (registerResult.waitForApproval) {
                    console.log(`⏳ [Pending] ${deviceId} waiting for admin approval - stopping data load`);
                    showLoading(false);
                    return; // STOP - wait for approval
                }

                // If already exists (approved), continue
                if (registerResult.alreadyExists) {
                    console.log(`✅ [Already Exists] ${deviceId} approved - continuing to load data`);
                }

                // Handle error
                if (!registerResult.success) {
                    console.warn(`⚠️ Request failed: ${registerResult.message}`);
                    showRegistrationWarning(deviceId, registerResult.message);
                }
            } else if (deviceCheck.exists) {
                console.log(`✅ [Device OK] ${deviceId} already in Lumentree Integration (${deviceCheck.entityCount} entities)`);
            }
        } catch (error) {
            console.warn('⚠️ Device check failed, continuing anyway:', error.message);
        }
        // ========================================

        // Show UI immediately
        showElement('deviceInfo');
        showElement('summaryStats');
        showElement('chart-section');
        showElement('realTimeFlow');
        showElement('batteryCellSection');

        updateDeviceInfo({
            deviceId: deviceId,
            deviceType: 'Lumentree Inverter',
            onlineStatus: 1,
            remarkName: ''
        });

        showCompactSearchBar(deviceId, date);
        showLoading(false);

        // Check if we have cached summary data for this device (for instant display)
        // NOTE: On F5/page load, we still show cached data for instant UX,
        // but we ALWAYS fetch fresh data below to update it
        const hasCachedData = summaryDataCache.deviceId === deviceId && summaryDataCache.data;

        if (hasCachedData) {
            // Use cached data immediately for instant display - no "Đang tải..."
            console.log('📦 Using cached summary data for instant display:', deviceId);
            applySummaryData(summaryDataCache.data);
        } else {
            // Only show "Đang tải..." if no cache
            updateValue('pv-total', 'Đang tải...');
            updateValue('bat-charge', 'Đang tải...');
            updateValue('bat-discharge', 'Đang tải...');
            updateValue('load-total', 'Đang tải...');
            updateValue('grid-total', 'Đang tải...');
            updateValue('essential-total', 'Đang tải...');
        }

        // ALWAYS clear chart cache on F5 to force fresh fetch
        // This ensures charts are always up-to-date after page reload
        console.log('🔄 F5 detected: Clearing chart cache to force fresh fetch');
        lightearthCache = { data: null, deviceId: null, date: null, timestamp: 0 };

        // ALWAYS fetch fresh daily-energy data on page load/F5
        // This ensures data is always up-to-date for ALL devices
        console.log('🔄 F5/Load: Always fetching fresh daily-energy for', deviceId);

        // Initialize cells waiting state
        if (!hasCellData) {
            initializeBatteryCellsWaiting();
        }

        // Show loading chart immediately (don't wait for Lightearth API)
        // Check if we have cached chart data first
        const queryDate = date || document.getElementById('dateInput')?.value || new Date().toISOString().split('T')[0];
        const hasCachedChart = lightearthCache.data &&
            lightearthCache.deviceId === deviceId &&
            lightearthCache.date === queryDate &&
            (Date.now() - lightearthCache.timestamp) < LIGHTEARTH_CACHE_TTL;

        if (hasCachedChart) {
            console.log('📦 Using cached chart data for instant display');
            // Apply cached data based on source type
            if (lightearthCache.data.dataSource === 'LightEarthCloud') {
                updateChartFromCloudData(lightearthCache.data);
            } else {
                updateSummaryFromLightearthData(lightearthCache.data);
            }
        } else {
            // Show loading chart placeholder while fetching
            showLoadingChart();
        }

        // STAGGERED API CALLS - Prevent flooding Cloudflare Tunnel
        // Each call is delayed to avoid overwhelming HA
        console.log('🚦 Starting staggered API calls to prevent tunnel flooding...');

        // 1. Fetch summary data first (most important)
        fetchRealtimeDataForSummary(deviceId);

        // 2. SOC data - delay 500ms
        setTimeout(() => {
            console.log('🔋 [Staggered] Fetching SOC data...');
            fetchSOCData().catch(err => console.error('❌ SOC fetch error:', err));
        }, 500);

        // 3. Temperature - delay 1000ms
        setTimeout(() => {
            console.log('🌡️ [Staggered] Fetching temperature data...');
            fetchTemperatureMinMax(deviceId, queryDate);
        }, 1000);

        // 4. Device info - delay 1500ms
        setTimeout(() => {
            fetchDeviceInfo(deviceId);
        }, 1500);

        // 5. Solar Project Summary - delay 2000ms
        setTimeout(() => {
            if (typeof window.loadSolarProjectSummary === 'function') {
                console.log('📊 [Staggered] Loading solar project summary...');
                window.loadSolarProjectSummary(deviceId);
            }
        }, 2000);

        // 6. Chart/Peak stats data - delay 2500ms
        setTimeout(() => {
            console.log('📊 [Staggered] Fetching peak stats data...');
            fetchDayDataInBackground(deviceId, queryDate, true).catch(err => console.warn('Day data error:', err));
        }, 2500);

        // 7. Auto-refresh daily-energy every 3 minutes (180 seconds)
        // Clear any existing interval first to prevent duplicates
        if (window.dailyEnergyRefreshInterval) {
            clearInterval(window.dailyEnergyRefreshInterval);
        }
        window.dailyEnergyRefreshInterval = setInterval(() => {
            console.log('🔄 [Auto-refresh] Fetching daily-energy data (3 min interval)...');
            fetchRealtimeDataForSummary(deviceId);
        }, 180000); // 3 minutes = 180,000ms
        console.log('✅ [Auto-refresh] Daily-energy interval set: every 3 minutes');
    }

    // Helper to apply summary data to UI
    function applySummaryData(data) {
        if (!data) return;
        console.log('📊 [applySummaryData] Updating UI with:', data);
        updateValue('pv-total', (data.pvDay || 0).toFixed(1) + ' kWh');
        updateValue('bat-charge', (data.chargeDay || 0).toFixed(1) + ' kWh');
        updateValue('bat-discharge', (data.dischargeDay || 0).toFixed(1) + ' kWh');
        updateValue('load-total', (data.loadDay || 0).toFixed(1) + ' kWh');
        updateValue('grid-total', (data.gridDay || 0).toFixed(1) + ' kWh');
        updateValue('essential-total', (data.essentialDay || 0).toFixed(1) + ' kWh');
        console.log('✅ [applySummaryData] UI updated - discharge:', (data.dischargeDay || 0).toFixed(1), 'kWh');
    }

    // Fetch summary data for the 3 cards (fast path - single API call)
    // ALWAYS fetches fresh data from /api/realtime/daily-energy/{deviceId}
    // This ensures Năng Lượng, Pin Lưu Trữ, Nguồn Điện are always updated
    // NOTE: Uses DAILY_ENERGY_API (applike098) which has proper CORS headers
    async function fetchRealtimeDataForSummary(deviceId) {
        try {
            const haEnergyUrl = `${DAILY_ENERGY_API}/api/realtime/daily-energy/${deviceId}`;
            console.log('⚡ [Daily Energy] Fetching from:', haEnergyUrl);

            const response = await fetch(haEnergyUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            console.log('📥 [Daily Energy] Response:', data);

            // Support both API formats:
            // 1. lightearth worker: data.today { pv, load, gridIn, charge, discharge, essential }
            // 2. temperature-soc-power worker: data.summary { pv_day, load_day, grid_day, charge_day, discharge_day, essential_day }
            const source = data.today || data.summary;

            if (data.success && source) {
                // Use !== undefined to handle 0 values correctly
                // Map both formats to unified cacheData
                const cacheData = {
                    pvDay: source.pv !== undefined ? source.pv : (source.pv_day !== undefined ? source.pv_day : 0),
                    chargeDay: source.charge !== undefined ? source.charge : (source.charge_day !== undefined ? source.charge_day : 0),
                    dischargeDay: source.discharge !== undefined ? source.discharge : (source.discharge_day !== undefined ? source.discharge_day : 0),
                    loadDay: source.load !== undefined ? source.load : (source.total_load_day !== undefined ? source.total_load_day : (source.load_day || 0)),
                    gridDay: source.gridIn !== undefined ? source.gridIn : (source.grid_day !== undefined ? source.grid_day : 0),
                    essentialDay: source.essential !== undefined ? source.essential : (source.essential_day !== undefined ? source.essential_day : 0)
                };

                // Cache the data
                summaryDataCache = {
                    deviceId: deviceId,
                    data: cacheData,
                    timestamp: Date.now()
                };
                saveSummaryCacheToLocalStorage(); // Persist to localStorage

                // ALWAYS update UI with fresh data
                applySummaryData(cacheData);
                console.log('✅ [Daily Energy] Updated UI for', deviceId, ':', cacheData);
            } else {
                console.warn('⚠️ [Daily Energy] No data in response for', deviceId);
            }
        } catch (error) {
            console.warn('⚠️ [Daily Energy] Fetch failed for', deviceId, ':', error.message);
            // If fetch fails and no cache, show error state
            if (!summaryDataCache.data || summaryDataCache.deviceId !== deviceId) {
                updateValue('pv-total', '-- kWh');
                updateValue('bat-charge', '-- kWh');
                updateValue('bat-discharge', '-- kWh');
                updateValue('load-total', '-- kWh');
                updateValue('grid-total', '-- kWh');
                updateValue('essential-total', '-- kWh');
            }
        }
    }

    // Fetch day data in background (for summary stats: Năng lượng - Pin Lưu Trữ - Nguồn Điện)
    // PRIORITY ORDER:
    // 1. Railway API (LightEarth Cloud data) - always try first for all devices
    // 2. Lightearth API - for chart data
    // forceRefresh = true: Skip cache and always fetch fresh data (used on F5/page load)
    async function fetchDayDataInBackground(deviceId, date, forceRefresh = false) {
        console.log('🚀🚀🚀 fetchDayDataInBackground CALLED:', { deviceId, date, forceRefresh });
        const queryDate = date || document.getElementById('dateInput')?.value || new Date().toISOString().split('T')[0];
        const now = Date.now();
        console.log('📅 Query date:', queryDate);

        // Clear chart cache if deviceId changed (summary cache is separate)
        if (lightearthCache.deviceId && lightearthCache.deviceId !== deviceId) {
            console.log(`🔄 Device changed from ${lightearthCache.deviceId} to ${deviceId}, clearing chart cache`);
            lightearthCache = { data: null, deviceId: null, date: null, timestamp: 0 };
        }

        // Clear summary cache only if device changed
        if (summaryDataCache.deviceId && summaryDataCache.deviceId !== deviceId) {
            console.log(`🔄 Clearing summary cache for new device`);
            summaryDataCache = { deviceId: null, data: null, timestamp: 0 };
        }

        // STEP 1: Skip Railway daily-energy API here - already fetched in fetchRealtimeDataForSummary()
        // Only fetch if cache is empty (for fallback)
        let railwayDataLoaded = summaryDataCache.deviceId === deviceId && summaryDataCache.data;

        if (!railwayDataLoaded) {
            try {
                console.log("📡 [Priority 1] Trying daily-energy API (applike098)...");
                const haEnergyUrl = `${DAILY_ENERGY_API}/api/realtime/daily-energy/${deviceId}`;
                const haResponse = await fetch(haEnergyUrl);

                if (haResponse.ok) {
                    const haData = await haResponse.json();

                    // Support both API formats (same as fetchRealtimeDataForSummary)
                    const source = haData.today || haData.summary;

                    if (haData.success && source) {
                        // Use !== undefined to handle 0 values correctly
                        const cacheData = {
                            pvDay: source.pv !== undefined ? source.pv : (source.pv_day !== undefined ? source.pv_day : 0),
                            chargeDay: source.charge !== undefined ? source.charge : (source.charge_day !== undefined ? source.charge_day : 0),
                            dischargeDay: source.discharge !== undefined ? source.discharge : (source.discharge_day !== undefined ? source.discharge_day : 0),
                            loadDay: source.load !== undefined ? source.load : (source.total_load_day !== undefined ? source.total_load_day : (source.load_day || 0)),
                            gridDay: source.gridIn !== undefined ? source.gridIn : (source.grid_day !== undefined ? source.grid_day : 0),
                            essentialDay: source.essential !== undefined ? source.essential : (source.essential_day !== undefined ? source.essential_day : 0)
                        };

                        // Cache and update
                        summaryDataCache = { deviceId, data: cacheData, timestamp: Date.now() };
                        saveSummaryCacheToLocalStorage(); // Persist to localStorage
                        applySummaryData(cacheData);

                        console.log("✅ [Priority 1] Railway API SUCCESS:", summary);
                        railwayDataLoaded = true;
                    }
                }
            } catch (haError) {
                console.warn("⚠️ [Priority 1] Railway API failed:", haError.message);
            }
        } else {
            console.log("📦 [Priority 1] Using cached summary data, skipping Railway API");
        }

        // STEP 2: Try LightEarth Cloud Power History API for chart data
        let chartDataLoaded = false;

        // Check cache first (skip if forceRefresh is true - F5/page load)
        if (!forceRefresh && lightearthCache.data &&
            lightearthCache.deviceId === deviceId &&
            lightearthCache.date === queryDate &&
            (now - lightearthCache.timestamp) < LIGHTEARTH_CACHE_TTL) {

            const cacheAge = Math.round((now - lightearthCache.timestamp) / 1000);
            console.log(`📦 Using cached chart data (age: ${cacheAge}s)`);

            // Check if cached data is from Cloud or Legacy API
            if (lightearthCache.data.dataSource === 'LightEarthCloud') {
                updateChartFromCloudData(lightearthCache.data);
            } else {
                updateSummaryFromLightearthData(lightearthCache.data);
            }
            return;
        }

        if (forceRefresh) {
            console.log('🔄 Force refresh: Skipping cache, fetching fresh data...');
        }

        // PRIORITY 1: Try Cloudflare Worker Power History API (with fallback support)
        try {
            // Add cache-busting timestamp to force fresh fetch on F5
            const cacheBuster = Date.now();
            const powerHistoryUrl = getPowerHistoryApiUrl(deviceId, queryDate) + `&_t=${cacheBuster}`;
            console.log("📊📊📊 [POWER CHART] Fetching from Worker API:", powerHistoryUrl);

            // Force no-cache to ensure fresh data on F5
            const railwayResponse = await fetch(powerHistoryUrl, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            console.log("📊 Railway response status:", railwayResponse.status, railwayResponse.ok);

            if (railwayResponse.ok) {
                const railwayData = await railwayResponse.json();
                console.log("📊 Railway API response:", railwayData);

                // Use Railway data if available (even 1 point is valid - data grows over time)
                if (railwayData.success && railwayData.timeline && railwayData.timeline.length > 0) {
                    console.log(`✅ Railway API SUCCESS: ${railwayData.timeline.length} data points`);

                    // Cache the Railway data
                    lightearthCache = {
                        data: { ...railwayData, dataSource: 'PowerHistoryCollector' },
                        deviceId: deviceId,
                        date: queryDate,
                        timestamp: now
                    };
                    console.log("💾 Chart data cached (TTL: 30 minutes)");
                    saveCacheToLocalStorage();

                    // Update chart with Railway data
                    updateChartFromCloudData(railwayData);
                    chartDataLoaded = true;
                    return; // Success!
                } else {
                    console.warn("⚠️ Railway API returned no data - collector may still be gathering data");
                }
            } else {
                console.warn(`⚠️ [Priority 1] Railway API failed: HTTP ${railwayResponse.status}`);
            }
        } catch (railwayError) {
            console.warn("⚠️ Railway API error:", railwayError.message);
        }

        // No fallback needed - Railway PowerHistoryCollector is the only source
        // Data will be available after collector runs (every 5 minutes)
        if (!chartDataLoaded) {
            console.log("ℹ️ No chart data yet - PowerHistoryCollector is gathering data every 5 minutes");
        }

        // STEP 3: Fetch ACCURATE peak values from dedicated power-peak endpoint
        // This scans ALL raw data (6000+ points) for accurate peak detection
        try {
            const peakUrl = LIGHTEARTH_API.cloudPowerPeak(deviceId, queryDate);
            console.log('🎯 [Power Peak] Fetching accurate peaks from:', peakUrl);

            const peakResponse = await fetch(peakUrl, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache' }
            });

            if (peakResponse.ok) {
                const peakData = await peakResponse.json();
                if (peakData.success && peakData.peaks) {
                    updatePeakStatsFromWorker(peakData.peaks);
                    console.log(`✅ [Power Peak] Accurate peaks updated (scanned ${peakData.dataPoints} raw data points)`);
                }
            }
        } catch (peakError) {
            console.warn('⚠️ [Power Peak] API error:', peakError.message);
        }
    }

    // Update peak stats UI from Worker power-peak API response
    // API format: { peaks: { pv: {max, time}, load: {max, time}, grid: {max, time}, charge: {max, time}, discharge: {max, time} }}
    function updatePeakStatsFromWorker(peaks) {
        if (!peaks) return;

        const updateEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const formatPeak = (val) => {
            if (!val || val === 0) return '--';
            return `${Math.round(val)} W`;
        };

        // PV Peak
        if (peaks.pv) {
            updateEl('chart-pv-peak', formatPeak(peaks.pv.max));
            updateEl('chart-pv-time', peaks.pv.time || '--:--');
        }

        // Charge Peak (battery > 0)
        if (peaks.charge) {
            updateEl('chart-charge-peak', formatPeak(peaks.charge.max));
            updateEl('chart-charge-time', peaks.charge.time || '--:--');
        }

        // Discharge Peak (|battery| when battery < 0)
        if (peaks.discharge) {
            updateEl('chart-discharge-peak', formatPeak(peaks.discharge.max));
            updateEl('chart-discharge-time', peaks.discharge.time || '--:--');
        }

        // Load Peak
        if (peaks.load) {
            updateEl('chart-load-peak', formatPeak(peaks.load.max));
            updateEl('chart-load-time', peaks.load.time || '--:--');
        }

        // Grid Peak
        if (peaks.grid) {
            updateEl('chart-grid-peak', formatPeak(peaks.grid.max));
            updateEl('chart-grid-time', peaks.grid.time || '--:--');
        }

        console.log('📊 Peak stats updated from Worker API:', {
            pv: `${peaks.pv?.max || 0}W @ ${peaks.pv?.time || '--:--'}`,
            charge: `${peaks.charge?.max || 0}W @ ${peaks.charge?.time || '--:--'}`,
            discharge: `${peaks.discharge?.max || 0}W @ ${peaks.discharge?.time || '--:--'}`,
            load: `${peaks.load?.max || 0}W @ ${peaks.load?.time || '--:--'}`,
            grid: `${peaks.grid?.max || 0}W @ ${peaks.grid?.time || '--:--'}`
        });
    }

    // ========================================
    // POWER TIMELINE CHART - Full Day Visualization
    // ========================================
    // powerTimelineChart is now declared at top level to avoid TDZ

    // Toggle dataset visibility on Power Timeline Chart
    window.togglePowerDataset = function (index) {
        if (!powerTimelineChart) return;

        const meta = powerTimelineChart.getDatasetMeta(index);
        meta.hidden = !meta.hidden;
        powerTimelineChart.update();

        // Update button appearance
        const buttons = document.querySelectorAll('#powerChartLegend .power-legend-btn');
        if (buttons[index]) {
            buttons[index].classList.toggle('opacity-40', meta.hidden);
            buttons[index].classList.toggle('active', !meta.hidden);
        }
    };

    // Toggle dataset visibility on Power Stacked Chart (Chart 2)
    window.togglePowerChart2Dataset = function (index) {
        if (!powerStackedChart) return;

        const meta = powerStackedChart.getDatasetMeta(index);
        meta.hidden = !meta.hidden;
        powerStackedChart.update();

        // Update button appearance for Chart 2
        const buttons = document.querySelectorAll('#powerChart2Legend .power-legend-btn');
        if (buttons[index]) {
            buttons[index].classList.toggle('opacity-40', meta.hidden);
            buttons[index].classList.toggle('active', !meta.hidden);
        }
    };

    // Switch between Charts (4 charts total)
    window.switchPowerChart = function (chartNum) {
        const containers = [
            document.getElementById('chart1Container'),
            document.getElementById('chart2Container'),
            document.getElementById('chart3Container'),
            document.getElementById('chart4Container')
        ];
        const buttons = [
            document.getElementById('chart1Btn'),
            document.getElementById('chart2Btn'),
            document.getElementById('chart3Btn'),
            document.getElementById('chart4Btn')
        ];

        // Validate
        if (!containers[0]) return;

        activeChartNumber = chartNum;

        // Haptic feedback on mobile
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }

        // Hide all containers, show selected
        containers.forEach((container, index) => {
            if (container) {
                container.classList.toggle('hidden', index !== chartNum - 1);
            }
        });

        // Update button styles
        buttons.forEach((btn, index) => {
            if (btn) {
                if (index === chartNum - 1) {
                    btn.classList.add('bg-indigo-500', 'text-white', 'shadow');
                    btn.classList.remove('text-slate-600', 'dark:text-slate-300');
                } else {
                    btn.classList.remove('bg-indigo-500', 'text-white', 'shadow');
                    btn.classList.add('text-slate-600', 'dark:text-slate-300');
                }
            }
        });

        // Render appropriate chart with cached data
        if (cachedChartData && cachedChartData.length > 0) {
            switch (chartNum) {
                case 2:
                    renderGridSourceChart(cachedChartData);
                    break;
                case 3:
                    renderPVTodayChart(cachedChartData);
                    break;
                case 4:
                    renderBatteryFlowChart(cachedChartData);
                    break;
            }
        }

        console.log(`📊 Switched to Chart ${chartNum}`);
    };

    // ========================================
    // REFRESH ALL DATA FOR DATE
    // ========================================

    // Global function to refresh all APIs when date changes
    window.refreshAllDataForDate = async function (date) {
        // Get deviceId from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const deviceId = urlParams.get('deviceId') || 'P250801055';
        const formattedDate = date || new Date().toISOString().split('T')[0];

        console.log(`🔄 Refreshing ALL data for date: ${formattedDate}`);

        // Show loading indicators
        const loadingEl = document.getElementById('powerChartLoading');
        if (loadingEl) loadingEl.classList.remove('hidden');

        try {
            // API 1: Solar Dashboard (summary data)
            const dashboardUrl = `https://temperature-soc-power.applike098.workers.dev/api/solar/dashboard/${deviceId}`;

            // API 2: Daily Energy
            const dailyEnergyUrl = `https://lightearth.applike098.workers.dev/api/realtime/daily-energy/${deviceId}`;

            // API 3: SOC History
            const socHistoryUrl = `https://temperature-soc-power.applike098.workers.dev/api/realtime/soc-history/${deviceId}?date=${formattedDate}`;

            // API 4: Temperature
            const temperatureUrl = `https://temperature-soc-power.minhlongt358.workers.dev/api/cloud/temperature/${deviceId}/${formattedDate}`;

            // API 5: Power History (main data for charts)
            const powerHistoryUrl = `https://temperature-soc-power.applike098.workers.dev/api/realtime/power-history/${deviceId}?date=${formattedDate}`;

            // Fetch all in parallel
            const [dashboardRes, dailyEnergyRes, socHistoryRes, temperatureRes, powerHistoryRes] = await Promise.allSettled([
                fetch(dashboardUrl),
                fetch(dailyEnergyUrl),
                fetch(socHistoryUrl),
                fetch(temperatureUrl),
                fetch(powerHistoryUrl)
            ]);

            console.log('✅ All API requests completed');

            // Process Power History (main timeline data for charts 1-4)
            if (powerHistoryRes.status === 'fulfilled' && powerHistoryRes.value.ok) {
                const powerData = await powerHistoryRes.value.json();
                console.log('📊 Power History response:', powerData);

                // API returns timeline directly, not inside data object
                const timeline = powerData.timeline || (powerData.data && powerData.data.timeline) || [];

                if (timeline.length > 0) {
                    cachedChartData = timeline;

                    // Update all power charts
                    updatePowerTimelineChart(timeline, formattedDate);

                    // Update currently active chart
                    switch (activeChartNumber) {
                        case 1:
                            // Chart 1 already updated by updatePowerTimelineChart
                            break;
                        case 2:
                            renderGridSourceChart(timeline);
                            break;
                        case 3:
                            renderPVTodayChart(timeline);
                            break;
                        case 4:
                            renderBatteryFlowChart(timeline);
                            break;
                    }

                    console.log('✅ Power charts updated with', timeline.length, 'data points');
                } else {
                    console.warn('⚠️ No timeline data in power history response');
                }
            }

            // Process SOC History
            if (socHistoryRes.status === 'fulfilled' && socHistoryRes.value.ok) {
                const socData = await socHistoryRes.value.json();
                if (socData && socData.data) {
                    // Update SOC chart if available
                    if (typeof renderSOCChart === 'function') {
                        renderSOCChart(socData.data);
                    }
                    console.log('✅ SOC chart updated');
                }
            }

            // Process Temperature
            if (temperatureRes.status === 'fulfilled' && temperatureRes.value.ok) {
                const tempData = await temperatureRes.value.json();
                if (tempData && tempData.data) {
                    cachedTempData = tempData.data;
                    if (typeof renderTemperatureChart === 'function' && activeSocTempTab === 'temp') {
                        renderTemperatureChart(tempData.data);
                    }
                    console.log('✅ Temperature data cached');
                }
            }

            // Update date display
            const dateEl = document.getElementById('energy-chart-date');
            if (dateEl) {
                const displayDate = new Date(formattedDate);
                dateEl.textContent = displayDate.toLocaleDateString('vi-VN', {
                    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric'
                });
            }

            // Haptic feedback on success
            if (navigator.vibrate) navigator.vibrate(50);

        } catch (error) {
            console.error('❌ Error refreshing data:', error);
        } finally {
            // Hide loading
            if (loadingEl) loadingEl.classList.add('hidden');
        }
    };

    // ========================================
    // SOC / TEMPERATURE CHART TOGGLE
    // ========================================

    // Switch between SOC and Temperature Chart
    window.switchSocTempChart = function (tab) {
        const socContainer = document.getElementById('socContainer');
        const tempContainer = document.getElementById('tempContainer');
        const socBtn = document.getElementById('socChartBtn');
        const tempBtn = document.getElementById('tempChartBtn');
        const titleText = document.getElementById('socTempTitleText');
        const titleIcon = document.getElementById('socTempIcon');

        if (!socContainer || !tempContainer) return;

        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate(10);

        activeSocTempTab = tab;

        if (tab === 'soc') {
            // Show SOC, hide Temperature
            socContainer.classList.remove('hidden');
            tempContainer.classList.add('hidden');

            // Update button styles
            socBtn.classList.add('bg-teal-500', 'text-white', 'shadow');
            socBtn.classList.remove('text-slate-600', 'dark:text-slate-300');
            tempBtn.classList.remove('bg-teal-500', 'text-white', 'shadow');
            tempBtn.classList.add('text-slate-600', 'dark:text-slate-300');

            // Update title
            if (titleText) titleText.textContent = 'Phần Trăm Pin (SOC)';
            if (titleIcon) {
                titleIcon.setAttribute('data-lucide', 'battery-full');
                titleIcon.classList.remove('text-orange-500');
                titleIcon.classList.add('text-teal-500');
            }

            // Re-render SOC chart to ensure haptic works (fix for initial load issue)
            if (typeof renderSOCChart === 'function' && socData && socData.length > 0) {
                setTimeout(() => renderSOCChart(), 100);
            }

        } else {
            // Show Temperature, hide SOC
            socContainer.classList.add('hidden');
            tempContainer.classList.remove('hidden');

            // Update button styles
            tempBtn.classList.add('bg-teal-500', 'text-white', 'shadow');
            tempBtn.classList.remove('text-slate-600', 'dark:text-slate-300');
            socBtn.classList.remove('bg-teal-500', 'text-white', 'shadow');
            socBtn.classList.add('text-slate-600', 'dark:text-slate-300');

            // Update title
            if (titleText) titleText.textContent = 'Biểu Đồ Nhiệt Độ Biến Tần';
            if (titleIcon) {
                titleIcon.setAttribute('data-lucide', 'thermometer');
                titleIcon.classList.remove('text-teal-500');
                titleIcon.classList.add('text-orange-500');
            }

            // Refresh lucide icons
            if (typeof lucide !== 'undefined') lucide.createIcons();

            // Fetch and display temperature data
            const deviceId = localStorage.getItem('selectedDevice') || localStorage.getItem('lastDeviceId');
            const queryDate = document.getElementById('dateInput')?.value || new Date().toISOString().split('T')[0];
            if (deviceId) {
                fetchTemperatureTimeline(deviceId, queryDate);
            }
        }

        console.log(`🌡️ Switched to ${tab === 'soc' ? 'SOC' : 'Temperature'} chart`);
    };

    // Fetch Temperature Timeline data from API
    async function fetchTemperatureTimeline(deviceId, date) {
        const loadingEl = document.getElementById('tempChartLoading');
        if (loadingEl) loadingEl.classList.remove('hidden');

        try {
            const url = `https://temperature-soc-power.applike098.workers.dev/api/cloud/temperature/${deviceId}/${date}`;
            console.log('🌡️ Fetching temperature timeline:', url);

            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            console.log('🌡️ Temperature data received:', data);

            if (data.success && data.timeline && data.timeline.length > 0) {
                // Cache the data
                cachedTempData = data;

                // Update UI with stats
                updateTemperatureStats(data);

                // Render chart
                updateTemperatureChart(data.timeline);
            } else {
                console.warn('⚠️ No temperature data available');
                updateTemperatureStats(null);
            }
        } catch (error) {
            console.error('❌ Temperature fetch error:', error);
            updateTemperatureStats(null);
        } finally {
            if (loadingEl) loadingEl.classList.add('hidden');
        }
    }

    // Update Temperature stats display
    function updateTemperatureStats(data) {
        const bigValue = document.getElementById('temp-big-value');
        const maxVal = document.getElementById('temp-max');
        const minVal = document.getElementById('temp-min');
        const maxTime = document.getElementById('temp-max-time');
        const minTime = document.getElementById('temp-min-time');

        if (data && data.current !== undefined) {
            if (bigValue) bigValue.textContent = `${data.current.toFixed(1)}°C`;
            if (maxVal) maxVal.textContent = `${data.max.toFixed(1)}°C`;
            if (minVal) minVal.textContent = `${data.min.toFixed(1)}°C`;
            if (maxTime) maxTime.textContent = data.maxTime ? `@ ${data.maxTime}` : '';
            if (minTime) minTime.textContent = data.minTime ? `@ ${data.minTime}` : '';
        } else {
            if (bigValue) bigValue.textContent = '--°C';
            if (maxVal) maxVal.textContent = '--°C';
            if (minVal) minVal.textContent = '--°C';
            if (maxTime) maxTime.textContent = '';
            if (minTime) minTime.textContent = '';
        }
    }

    // Render Temperature Chart (Area chart with gradient)
    function updateTemperatureChart(timeline) {
        const canvas = document.getElementById('tempChart');
        if (!canvas) {
            console.warn('⚠️ tempChart canvas not found');
            return;
        }

        // Prepare data
        const labels = [];
        const tempData = [];

        timeline.forEach(point => {
            const time = point.t || point.time || '';
            labels.push(time);
            tempData.push(point.temp || 0);
        });

        // Destroy existing chart
        if (tempChartInstance) {
            tempChartInstance.destroy();
        }

        const ctx = canvas.getContext('2d');

        // Create gradient for temperature (orange to red)
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(249, 115, 22, 0.6)');   // Orange
        gradient.addColorStop(0.5, 'rgba(249, 115, 22, 0.3)');
        gradient.addColorStop(1, 'rgba(249, 115, 22, 0.05)');

        tempChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Nhiệt Độ',
                    data: tempData,
                    borderColor: '#f97316',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 12,
                    pointHoverBackgroundColor: '#f97316',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                onHover: (event, elements) => { if (elements.length) triggerHaptic(); },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#fb923c',
                        titleFont: { size: 11 },
                        bodyFont: { size: 16, weight: 'bold' },
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            title: (items) => `⏰ ${items[0].label}`,
                            label: (context) => `🌡️ ${context.parsed.y.toFixed(1)}°C`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        suggestedMin: Math.min(...tempData) - 5,
                        suggestedMax: Math.max(...tempData) + 5,
                        grid: {
                            color: 'rgba(148, 163, 184, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => `${value}°C`,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxTicksLimit: 6
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 9 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    }
                }
            }
        });

        console.log('✅ Temperature Chart created with', timeline.length, 'data points');
    }

    // Update Power 3D Stacked Bar Chart (Chart 2) - PREMIUM 3D DESIGN
    function updatePowerStackedChart(timeline) {
        const canvas = document.getElementById('powerStackedChart');
        const loadingEl = document.getElementById('powerChart2Loading');

        if (!canvas) {
            console.warn('⚠️ powerStackedChart canvas not found');
            return;
        }

        // Hide loading overlay
        if (loadingEl) loadingEl.classList.add('hidden');

        // Create hourly labels (24 hours) - show every 2 hours for cleaner look
        const hourLabels = [];
        for (let h = 0; h < 24; h++) {
            hourLabels.push(h % 2 === 0 ? `${String(h).padStart(2, '0')}h` : '');
        }

        // Initialize hourly data (average values per hour)
        const pvHourly = new Array(24).fill(0);
        const loadHourly = new Array(24).fill(0);
        const gridHourly = new Array(24).fill(0);
        const batteryHourly = new Array(24).fill(0); // Combined: positive = charge, negative = discharge (shown as positive)
        const hourCounts = new Array(24).fill(0);

        // Aggregate data by hour
        timeline.forEach(point => {
            const timeStr = point.t || point.time || '';
            let hours;

            if (timeStr.includes('T')) {
                const d = new Date(timeStr);
                hours = d.getHours();
            } else if (timeStr.includes(':')) {
                hours = parseInt(timeStr.split(':')[0], 10);
            } else {
                return;
            }

            if (hours < 0 || hours >= 24) return;

            const pv = point.pvPower ?? point.pv ?? 0;
            const load = point.loadPower ?? point.load ?? 0;
            const grid = point.gridPower ?? point.grid ?? 0;
            const bat = point.batteryPower ?? point.bat ?? point.battery ?? 0;

            pvHourly[hours] += pv;
            loadHourly[hours] += load;
            gridHourly[hours] += grid;
            // For stacked bar, show battery activity as positive value
            batteryHourly[hours] += Math.abs(bat);
            hourCounts[hours]++;
        });

        // Calculate averages
        for (let h = 0; h < 24; h++) {
            if (hourCounts[h] > 0) {
                pvHourly[h] = Math.round(pvHourly[h] / hourCounts[h]);
                loadHourly[h] = Math.round(loadHourly[h] / hourCounts[h]);
                gridHourly[h] = Math.round(gridHourly[h] / hourCounts[h]);
                batteryHourly[h] = Math.round(batteryHourly[h] / hourCounts[h]);
            }
        }

        // Destroy existing chart
        if (powerStackedChart) {
            powerStackedChart.destroy();
        }

        const ctx = canvas.getContext('2d');

        // 3D Effect Plugin - draws shadow/depth behind bars
        const pseudo3DPlugin = {
            id: 'pseudo3D',
            beforeDatasetsDraw(chart) {
                const { ctx, data, scales } = chart;
                const meta = chart.getDatasetMeta(0);
                if (!meta.data.length) return;

                const barWidth = meta.data[0].width || 10;
                const depth = 8; // 3D depth in pixels
                const offsetX = 4;
                const offsetY = -4;

                ctx.save();

                // Draw 3D shadow for each bar stack
                data.datasets.forEach((dataset, datasetIndex) => {
                    const meta = chart.getDatasetMeta(datasetIndex);
                    meta.data.forEach((bar, index) => {
                        const { x, y, base, width, height } = bar;

                        // Create 3D shadow color (darker version)
                        const originalColor = dataset.backgroundColor;
                        let shadowColor = originalColor.replace(/[\d.]+\)$/, '0.4)');

                        // Draw side face (3D effect)
                        ctx.fillStyle = shadowColor;
                        ctx.beginPath();
                        ctx.moveTo(x + width / 2, y);
                        ctx.lineTo(x + width / 2 + offsetX, y + offsetY);
                        ctx.lineTo(x + width / 2 + offsetX, base + offsetY);
                        ctx.lineTo(x + width / 2, base);
                        ctx.closePath();
                        ctx.fill();

                        // Draw top face (3D effect)
                        ctx.beginPath();
                        ctx.moveTo(x - width / 2, y);
                        ctx.lineTo(x - width / 2 + offsetX, y + offsetY);
                        ctx.lineTo(x + width / 2 + offsetX, y + offsetY);
                        ctx.lineTo(x + width / 2, y);
                        ctx.closePath();
                        ctx.fill();
                    });
                });

                ctx.restore();
            }
        };

        // Create gradients for 3D effect
        const createBarGradient = (color1, color2) => {
            const gradient = ctx.createLinearGradient(0, 0, 0, 280);
            gradient.addColorStop(0, color1);
            gradient.addColorStop(1, color2);
            return gradient;
        };

        powerStackedChart = new Chart(ctx, {
            type: 'bar',
            plugins: [pseudo3DPlugin],
            data: {
                labels: hourLabels,
                datasets: [
                    {
                        label: '☀️ PV',
                        data: pvHourly,
                        backgroundColor: 'rgba(251, 191, 36, 0.85)',
                        borderColor: '#f59e0b',
                        borderWidth: 1,
                        borderRadius: { topLeft: 4, topRight: 4 },
                        borderSkipped: false
                    },
                    {
                        label: '🔌 Lưới',
                        data: gridHourly,
                        backgroundColor: 'rgba(192, 132, 252, 0.85)',
                        borderColor: '#a855f7',
                        borderWidth: 1,
                        borderRadius: 0
                    },
                    {
                        label: '🔋 Pin',
                        data: batteryHourly,
                        backgroundColor: 'rgba(52, 211, 153, 0.85)',
                        borderColor: '#10b981',
                        borderWidth: 1,
                        borderRadius: 0
                    },
                    {
                        label: '🏠 Tải',
                        data: loadHourly,
                        backgroundColor: 'rgba(96, 165, 250, 0.85)',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        borderRadius: { bottomLeft: 4, bottomRight: 4 },
                        borderSkipped: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        padding: 14,
                        cornerRadius: 10,
                        displayColors: true,
                        boxWidth: 12,
                        boxHeight: 12,
                        usePointStyle: true,
                        callbacks: {
                            title: (items) => {
                                const hour = items[0].dataIndex;
                                return `⏰ ${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`;
                            },
                            label: (context) => {
                                const value = context.parsed.y;
                                if (value === null || value === 0) return null;
                                const kw = value >= 1000 ? (value / 1000).toFixed(1) + ' kW' : value + ' W';
                                return ` ${context.dataset.label}: ${kw}`;
                            },
                            footer: (items) => {
                                const total = items.reduce((sum, item) => sum + (item.parsed.y || 0), 0);
                                const totalKw = total >= 1000 ? (total / 1000).toFixed(1) + ' kW' : total + ' W';
                                return `───────────\n📊 Tổng: ${totalKw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(148, 163, 184, 0.12)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => value >= 1000 ? (value / 1000).toFixed(0) + 'kW' : value + 'W',
                            font: { size: 10, weight: '500' },
                            color: 'rgba(148, 163, 184, 0.8)',
                            maxTicksLimit: 6
                        }
                    },
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: {
                            font: { size: 9, weight: '600' },
                            color: 'rgba(148, 163, 184, 0.8)',
                            maxRotation: 0
                        }
                    }
                },
                animation: {
                    duration: 600,
                    easing: 'easeOutQuart'
                }
            }
        });

        console.log('✅ Power 3D Stacked Bar Chart (Chart 2) created - 24 hourly bars');
    }

    // ========================================
    // CHART 2: Tổng Nguồn điện (Grid Source Chart)
    // ========================================
    let gridSourceChartInstance = null;

    function renderGridSourceChart(timeline) {
        const canvas = document.getElementById('gridSourceChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Create full 24h timeline
        const fullLabels = [];
        for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 5) {
                fullLabels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
        }

        // Initialize data arrays
        const gridPurchase = new Array(288).fill(0);  // CS mua từ lưới
        const loadPower = new Array(288).fill(0);     // Công suất cổng load  
        const gridFeedIn = new Array(288).fill(0);    // Tải hòa lưới

        // Fill data from timeline
        timeline.forEach(point => {
            const timeStr = point.t || point.time;
            if (!timeStr) return;
            const [hours, minutes] = timeStr.split(':').map(Number);
            const slotIndex = hours * 12 + Math.floor(minutes / 5);
            if (slotIndex >= 0 && slotIndex < 288) {
                // Grid purchase = EVN consumption (positive grid)
                const gridVal = point.grid ?? point.gridPower ?? 0;
                gridPurchase[slotIndex] = Math.max(0, gridVal);
                // Load power = Total consumption  
                loadPower[slotIndex] = point.load ?? point.loadPower ?? 0;
                // Grid feed-in (negative grid = selling to grid)
                gridFeedIn[slotIndex] = Math.abs(Math.min(0, gridVal));
            }
        });

        if (gridSourceChartInstance) {
            gridSourceChartInstance.destroy();
        }

        // Create gradient for grid feed-in area
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.1)');

        gridSourceChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: fullLabels,
                datasets: [
                    {
                        label: 'Tải hòa lưới',
                        data: gridFeedIn,
                        borderColor: '#3b82f6',
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        borderWidth: 2,
                        order: 3
                    },
                    {
                        label: 'Công suất cổng load',
                        data: loadPower,
                        borderColor: '#22c55e',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        borderWidth: 1.5,
                        order: 2
                    },
                    {
                        label: 'CS mua từ lưới',
                        data: gridPurchase,
                        borderColor: '#f59e0b',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        borderWidth: 1.5,
                        order: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onHover: (event, elements) => { if (elements.length) triggerHaptic(); },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: true,
                        boxWidth: 10,
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 11 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.15)', drawBorder: false },
                        ticks: {
                            callback: (value) => value >= 1000 ? (value / 1000).toFixed(1) + 'K' : value,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 7,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)',
                            callback: function (val, index) {
                                const label = this.getLabelForValue(val);
                                return label.endsWith(':00') ? label : '';
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ Grid Source Chart rendered');
    }

    // ========================================
    // CHART 3: Tổng PV hôm nay (PV Today Chart)
    // ========================================
    let pvTodayChartInstance = null;

    function renderPVTodayChart(timeline) {
        const canvas = document.getElementById('pvTodayChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Create full 24h timeline
        const fullLabels = [];
        for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 5) {
                fullLabels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
        }

        // Initialize PV data
        const pvData = new Array(288).fill(0);
        let totalPVWh = 0;

        // Fill data from timeline
        timeline.forEach(point => {
            const timeStr = point.t || point.time;
            if (!timeStr) return;
            const [hours, minutes] = timeStr.split(':').map(Number);
            const slotIndex = hours * 12 + Math.floor(minutes / 5);
            if (slotIndex >= 0 && slotIndex < 288) {
                const pvVal = point.pv ?? point.pvPower ?? 0;
                pvData[slotIndex] = pvVal;
                totalPVWh += pvVal / 12; // 5-minute interval = 1/12 hour
            }
        });

        // Update total display
        const totalEl = document.getElementById('pvTodayTotal');
        if (totalEl) {
            const totalKWh = (totalPVWh / 1000).toFixed(1);
            totalEl.textContent = `${totalKWh} KWh`;
        }

        if (pvTodayChartInstance) {
            pvTodayChartInstance.destroy();
        }

        // Create amber gradient (matching Chart tổng hợp PV color)
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(251, 191, 36, 0.6)');
        gradient.addColorStop(1, 'rgba(251, 191, 36, 0.1)');

        pvTodayChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: fullLabels,
                datasets: [{
                    label: 'PV Power',
                    data: pvData,
                    borderColor: '#fbbf24',
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onHover: (event, elements) => { if (elements.length) triggerHaptic(); },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#fbbf24',
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 14, weight: 'bold' },
                        callbacks: {
                            label: (context) => `☀️ ${context.parsed.y} W`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(148, 163, 184, 0.15)', drawBorder: false },
                        ticks: {
                            callback: (value) => value >= 1000 ? (value / 1000).toFixed(1) + 'K' : value,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 7,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)',
                            callback: function (val, index) {
                                const label = this.getLabelForValue(val);
                                return label.endsWith(':00') ? label : '';
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ PV Today Chart rendered');
    }

    // ========================================
    // CHART 4: Sạc & Xả Pin (Battery Flow Chart)
    // ========================================
    let batteryFlowChartInstance = null;

    function renderBatteryFlowChart(timeline) {
        const canvas = document.getElementById('batteryFlowChart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Create full 24h timeline
        const fullLabels = [];
        for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 5) {
                fullLabels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
        }

        // Battery flow data - positive = charge, negative = discharge
        const batteryFlow = new Array(288).fill(0);
        let totalChargeWh = 0;
        let totalDischargeWh = 0;

        // Fill data from timeline
        timeline.forEach(point => {
            const timeStr = point.t || point.time;
            if (!timeStr) return;
            const [hours, minutes] = timeStr.split(':').map(Number);
            const slotIndex = hours * 12 + Math.floor(minutes / 5);
            if (slotIndex >= 0 && slotIndex < 288) {
                // API returns bat: negative = discharge, positive = charge
                const batPower = point.bat ?? point.batteryPower ?? 0;
                // For chart: positive = charge (above 0), negative = discharge (below 0)
                // API bat is already correct sign, just use directly
                batteryFlow[slotIndex] = batPower;

                if (batPower > 0) {
                    totalChargeWh += batPower / 12;
                } else {
                    totalDischargeWh += Math.abs(batPower) / 12;
                }
            }
        });

        // Update totals display
        const chargeEl = document.getElementById('chargeTotal');
        const dischargeEl = document.getElementById('dischargeTotal');
        if (chargeEl) chargeEl.textContent = `${(totalChargeWh / 1000).toFixed(1)} KWh`;
        if (dischargeEl) dischargeEl.textContent = `${(totalDischargeWh / 1000).toFixed(1)} KWh`;

        if (batteryFlowChartInstance) {
            batteryFlowChartInstance.destroy();
        }

        // Create pink/salmon gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(244, 114, 182, 0.6)');
        gradient.addColorStop(0.5, 'rgba(244, 114, 182, 0.3)');
        gradient.addColorStop(1, 'rgba(244, 114, 182, 0.1)');

        batteryFlowChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: fullLabels,
                datasets: [{
                    label: 'Battery Flow',
                    data: batteryFlow,
                    borderColor: '#f472b6',
                    backgroundColor: gradient,
                    fill: 'origin',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                onHover: (event, elements) => { if (elements.length) triggerHaptic(); },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 14, weight: 'bold' },
                        callbacks: {
                            label: (context) => {
                                const val = context.parsed.y;
                                if (val > 0) return `⚡ Sạc: ${val} W`;
                                if (val < 0) return `🔋 Xả: ${Math.abs(val)} W`;
                                return `🔋 0 W`;
                            },
                            labelTextColor: (context) => {
                                const val = context.parsed.y;
                                if (val > 0) return '#22c55e'; // Green for charge
                                if (val < 0) return '#ef4444'; // Red for discharge
                                return '#e2e8f0'; // Default
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        grid: {
                            color: (context) => context.tick.value === 0 ? 'rgba(148, 163, 184, 0.5)' : 'rgba(148, 163, 184, 0.15)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => {
                                if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
                                if (value <= -1000) return (value / 1000).toFixed(1) + 'K';
                                return value;
                            },
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxTicksLimit: 7,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)',
                            callback: function (val, index) {
                                const label = this.getLabelForValue(val);
                                return label.endsWith(':00') ? label : '';
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ Battery Flow Chart rendered');
    }

    // Update Power Timeline Chart with full day data (6 datasets, 24h full timeline)
    function updatePowerTimelineChart(timeline, date) {
        const canvas = document.getElementById('powerTimelineChart');
        const loadingEl = document.getElementById('powerChartLoading');

        if (!canvas) {
            console.warn('⚠️ powerTimelineChart canvas not found');
            return;
        }

        // Hide loading overlay
        if (loadingEl) loadingEl.classList.add('hidden');

        // Create full 24h timeline (288 slots for 5-minute intervals: 00:00 to 23:55)
        const fullLabels = [];
        for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 5) {
                fullLabels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
        }

        // Initialize 6 datasets with 0 values (full 24h baseline)
        // Using 0 instead of null to show continuous baseline at zero level
        const pvData = new Array(288).fill(0);
        const loadData = new Array(288).fill(0);
        const gridData = new Array(288).fill(0);
        const chargeData = new Array(288).fill(0);    // Nạp pin (positive battery)
        const dischargeData = new Array(288).fill(0); // Xả pin (absolute of negative battery)
        const backupData = new Array(288).fill(0);    // Dự phòng

        // Calculate totals for summary
        let totalPv = 0, totalLoad = 0, totalGrid = 0, totalCharge = 0, totalDischarge = 0, totalBackup = 0;

        // Fill data from timeline
        timeline.forEach(point => {
            // Get time label and slot index
            const timeStr = point.t || point.time || '';
            let hours, minutes;

            if (timeStr.includes('T')) {
                const d = new Date(timeStr);
                hours = d.getHours();
                minutes = d.getMinutes();
            } else if (timeStr.includes(':')) {
                const parts = timeStr.split(':');
                hours = parseInt(parts[0], 10);
                minutes = parseInt(parts[1], 10);
            } else {
                return; // Skip invalid time
            }

            const slotIndex = hours * 12 + Math.floor(minutes / 5);
            if (slotIndex < 0 || slotIndex >= 288) return;

            // Get values (support multiple formats)
            const pv = point.pvPower ?? point.pv ?? 0;
            const load = point.loadPower ?? point.load ?? 0;
            const grid = point.gridPower ?? point.grid ?? 0;
            const bat = point.batteryPower ?? point.bat ?? point.battery ?? 0;
            const backup = point.backupPower ?? point.backup ?? point.essential ?? 0;

            // Store in arrays
            pvData[slotIndex] = pv;
            loadData[slotIndex] = load;
            gridData[slotIndex] = grid;
            chargeData[slotIndex] = bat > 0 ? bat : 0;        // Only positive = charging
            dischargeData[slotIndex] = bat < 0 ? Math.abs(bat) : 0; // Only negative = discharging
            backupData[slotIndex] = backup;

            // Accumulate totals (Wh per 5 min = W * 5/60)
            totalPv += pv * (5 / 60) / 1000;  // kWh
            totalLoad += load * (5 / 60) / 1000;
            totalGrid += grid * (5 / 60) / 1000;
            if (bat > 0) totalCharge += bat * (5 / 60) / 1000;
            else totalDischarge += Math.abs(bat) * (5 / 60) / 1000;
            totalBackup += backup * (5 / 60) / 1000;
        });

        console.log(`📈 Power chart: 288 slots (24h), Data points: ${timeline.length}, PV: ${totalPv.toFixed(1)} kWh`);

        // Destroy existing chart
        if (powerTimelineChart) {
            powerTimelineChart.destroy();
        }

        const ctx = canvas.getContext('2d');

        // Create gradients (taller chart = 450px)
        const createGradient = (color1, color2) => {
            const gradient = ctx.createLinearGradient(0, 0, 0, 450);
            gradient.addColorStop(0, color1);
            gradient.addColorStop(1, color2);
            return gradient;
        };

        powerTimelineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: fullLabels,
                datasets: [
                    {
                        label: 'PV',
                        data: pvData,
                        borderColor: '#f59e0b',
                        backgroundColor: createGradient('rgba(245, 158, 11, 0.25)', 'rgba(245, 158, 11, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#f59e0b',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'Tải',
                        data: loadData,
                        borderColor: '#3b82f6',
                        backgroundColor: createGradient('rgba(59, 130, 246, 0.25)', 'rgba(59, 130, 246, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#3b82f6',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'EVN',
                        data: gridData,
                        borderColor: '#a855f7',
                        backgroundColor: createGradient('rgba(168, 85, 247, 0.25)', 'rgba(168, 85, 247, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#a855f7',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'Nạp Pin',
                        data: chargeData,
                        borderColor: '#22c55e',
                        backgroundColor: createGradient('rgba(34, 197, 94, 0.25)', 'rgba(34, 197, 94, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#22c55e',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'Xả Pin',
                        data: dischargeData,
                        borderColor: '#ef4444',
                        backgroundColor: createGradient('rgba(239, 68, 68, 0.25)', 'rgba(239, 68, 68, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#ef4444',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    },
                    {
                        label: 'Dự Phòng',
                        data: backupData,
                        borderColor: '#06b6d4',
                        backgroundColor: createGradient('rgba(6, 182, 212, 0.25)', 'rgba(6, 182, 212, 0.02)'),
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 12,
                        pointHoverBorderWidth: 3,
                        pointHoverBackgroundColor: '#06b6d4',
                        pointHoverBorderColor: '#fff',
                        spanGaps: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    intersect: false,
                    axis: 'x'
                },
                hover: {
                    mode: 'nearest',
                    intersect: false
                },
                onHover: (event, elements) => { if (elements.length) triggerHaptic(); },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#e2e8f0',
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            title: (items) => `⏰ ${items[0].label}`,
                            label: (context) => {
                                const icons = ['☀️', '🏠', '🔌', '🔋+', '🔋-', '🛡️'];
                                const value = context.parsed.y;
                                if (value === null) return null;
                                return `${icons[context.datasetIndex]} ${context.dataset.label}: ${Math.round(value)} W`;
                            },
                            filter: (item) => item.parsed.y !== null && item.parsed.y > 0
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(148, 163, 184, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: (value) => value >= 1000 ? (value / 1000).toFixed(1) + 'kW' : value + 'W',
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxTicksLimit: 8
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 9 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12,
                            callback: function (value, index) {
                                // Show only hours: 00:00, 02:00, 04:00, etc.
                                const label = this.getLabelForValue(value);
                                if (label && label.endsWith(':00') && parseInt(label.split(':')[0]) % 2 === 0) {
                                    return label.split(':')[0] + 'h';
                                }
                                return '';
                            }
                        }
                    }
                }
            }
        });

        console.log('✅ Power Timeline Chart created (6 datasets, 24h timeline)');
    }

    // Convert Railway Power History data to chart format (288 points for 5-minute intervals)
    // Data mapping:
    // - pv: Sản lượng PV (pv_power)
    // - load: Tiêu Thụ (load_power)
    // - bat: Nạp Pin (bat > 0) / Xả Pin (bat < 0)
    // - grid: Xài Điện EVN (grid_power)
    // - backup: Điện dự phòng (ac_output_power)
    function convertRailwayPowerToChartData(timeline) {
        // Create 288 slots for each 5-minute interval (00:00 to 23:55)
        const pvData = new Array(288).fill(0);
        const batData = new Array(288).fill(0);
        const loadData = new Array(288).fill(0);
        const gridData = new Array(288).fill(0);
        const backupData = new Array(288).fill(0);  // Điện dự phòng

        // Fill in data from timeline
        timeline.forEach(point => {
            // Parse time (HH:mm format) to get slot index
            const timeParts = point.t.split(':');
            if (timeParts.length >= 2) {
                const hours = parseInt(timeParts[0], 10);
                const minutes = parseInt(timeParts[1], 10);
                const slotIndex = hours * 12 + Math.floor(minutes / 5);

                if (slotIndex >= 0 && slotIndex < 288) {
                    pvData[slotIndex] = point.pv || 0;
                    batData[slotIndex] = point.bat || 0;
                    loadData[slotIndex] = point.load || 0;
                    gridData[slotIndex] = point.grid || 0;
                    backupData[slotIndex] = point.backup || 0;  // Điện dự phòng
                }
            }
        });

        // Forward-fill gaps (use previous value for missing data points)
        for (let i = 1; i < 288; i++) {
            if (pvData[i] === 0 && pvData[i - 1] !== 0) pvData[i] = pvData[i - 1];
            if (loadData[i] === 0 && loadData[i - 1] !== 0) loadData[i] = loadData[i - 1];
            if (gridData[i] === 0 && gridData[i - 1] !== 0) gridData[i] = gridData[i - 1];
            if (backupData[i] === 0 && backupData[i - 1] !== 0) backupData[i] = backupData[i - 1];
            // Battery data is different - 0 is valid, so don't forward fill
        }

        console.log(`📊 Converted Railway data: ${timeline.length} points -> 288 chart slots (with backup)`);

        return {
            pv: { tableValueInfo: pvData },
            bat: { tableValueInfo: batData },
            load: { tableValueInfo: loadData },
            grid: { tableValueInfo: gridData },
            essentialLoad: { tableValueInfo: backupData }  // Map backup to essentialLoad for UI
        };
    }

    // Update peak stats from Railway Power History data
    function updateEnergyChartPeakStatsFromRailway(powerData) {
        if (!powerData || !powerData.timeline) return;

        const timeline = powerData.timeline;

        // Find peak values and times
        let maxPv = 0, maxPvTime = '--:--';
        let maxLoad = 0, maxLoadTime = '--:--';
        let maxGrid = 0, maxGridTime = '--:--';

        timeline.forEach(point => {
            if (point.pv > maxPv) {
                maxPv = point.pv;
                maxPvTime = point.t;
            }
            if (point.load > maxLoad) {
                maxLoad = point.load;
                maxLoadTime = point.t;
            }
            if (point.grid > maxGrid) {
                maxGrid = point.grid;
                maxGridTime = point.t;
            }
        });

        // Update UI
        const pvMaxEl = document.getElementById('pv-max-value');
        const pvMaxTimeEl = document.getElementById('pv-max-time');
        const loadMaxEl = document.getElementById('load-max-value');
        const loadMaxTimeEl = document.getElementById('load-max-time');
        const gridMaxEl = document.getElementById('grid-max-value');
        const gridMaxTimeEl = document.getElementById('grid-max-time');

        if (pvMaxEl) pvMaxEl.textContent = maxPv > 0 ? `${maxPv} W` : '--';
        if (pvMaxTimeEl) pvMaxTimeEl.textContent = maxPv > 0 ? maxPvTime : '--:--';
        if (loadMaxEl) loadMaxEl.textContent = maxLoad > 0 ? `${maxLoad} W` : '--';
        if (loadMaxTimeEl) loadMaxTimeEl.textContent = maxLoad > 0 ? maxLoadTime : '--:--';
        if (gridMaxEl) gridMaxEl.textContent = maxGrid > 0 ? `${maxGrid} W` : '--';
        if (gridMaxTimeEl) gridMaxTimeEl.textContent = maxGrid > 0 ? maxGridTime : '--:--';

        console.log("📊 Peak stats updated from Railway:", {
            pv: `${maxPv}W @ ${maxPvTime}`,
            load: `${maxLoad}W @ ${maxLoadTime}`,
            grid: `${maxGrid}W @ ${maxGridTime}`
        });
    }

    // Update chart from LightEarth Cloud Power History data
    // Timeline format: [{time: "HH:mm", pv: 0, battery: 0, grid: 0, load: 0}, ...]
    function updateChartFromCloudData(cloudData) {
        if (!cloudData || !cloudData.timeline || cloudData.timeline.length === 0) {
            console.warn("⚠️ No Cloud data to update chart");
            return;
        }

        const timeline = cloudData.timeline;
        console.log(`📊 Converting Cloud data to chart format: ${timeline.length} data points`);

        // Get current time slot - for TODAY, we limit data to current time
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentSlot = currentHour * 12 + Math.floor(currentMinute / 5);

        // Check if data is for today
        const queryDate = cloudData.date || document.getElementById('dateInput')?.value;
        const todayStr = now.toISOString().split('T')[0];
        const isToday = queryDate === todayStr;

        // Maximum slot to show data: current time for today, 287 for past days
        const maxAllowedSlot = isToday ? currentSlot : 287;

        console.log(`📊 Today: ${todayStr}, Query: ${queryDate}, isToday: ${isToday}, maxAllowedSlot: ${maxAllowedSlot}`);

        // Create 288 slots for each 5-minute interval (00:00 to 23:55)
        const pvData = new Array(288).fill(null);
        const batData = new Array(288).fill(null);
        const loadData = new Array(288).fill(null);
        const gridData = new Array(288).fill(null);

        // Track the last slot with actual non-zero data
        let lastDataSlot = -1;

        // Fill in data from timeline
        // Support multiple formats:
        // - Worker v2.1: { t: "HH:mm", pv, bat, load, grid, backup }
        // - Railway: { time: "HH:mm" or ISO, pvPower, batteryPower, loadPower, gridPower }
        // - Legacy: { time: ISO, pv, battery, load, grid }
        timeline.forEach((point, index) => {
            // Parse time from "t" or "time" field
            let hours, minutes;
            const timeStr = point.t || point.time;

            if (timeStr && timeStr.includes(':') && timeStr.length <= 5) {
                // Format: "HH:mm"
                const parts = timeStr.split(':');
                hours = parseInt(parts[0], 10);
                minutes = parseInt(parts[1], 10);
            } else if (timeStr && timeStr.includes('T')) {
                // Legacy ISO format (backwards compatibility)
                const d = new Date(timeStr);
                hours = d.getHours();
                minutes = d.getMinutes();
            } else {
                // Fallback: use index position (each index = 5 minutes)
                hours = Math.floor(index / 12);
                minutes = (index % 12) * 5;
            }

            const slotIndex = hours * 12 + Math.floor(minutes / 5);

            // Only include data for valid slots
            if (slotIndex >= 0 && slotIndex < 288 && slotIndex <= maxAllowedSlot) {
                // Support all formats: Worker (bat), Railway (batteryPower), Legacy (battery)
                pvData[slotIndex] = point.pvPower ?? point.pv ?? 0;
                batData[slotIndex] = point.batteryPower ?? point.bat ?? point.battery ?? 0;
                loadData[slotIndex] = point.loadPower ?? point.load ?? 0;
                gridData[slotIndex] = point.gridPower ?? point.grid ?? 0;

                // Track last slot with any actual data (non-zero)
                const pv = point.pvPower ?? point.pv ?? 0;
                const bat = point.batteryPower ?? point.bat ?? point.battery ?? 0;
                const load = point.loadPower ?? point.load ?? 0;
                const grid = point.gridPower ?? point.grid ?? 0;
                const hasData = (pv > 0) || (bat !== 0) || (load > 0) || (grid > 0);
                if (hasData && slotIndex > lastDataSlot) {
                    lastDataSlot = slotIndex;
                }
            }
        });

        // If no actual data found, use the last processed slot
        if (lastDataSlot === -1) {
            lastDataSlot = Math.min(timeline.length - 1, maxAllowedSlot);
        }

        console.log(`📊 Last data slot: ${lastDataSlot} (${Math.floor(lastDataSlot / 12)}:${String((lastDataSlot % 12) * 5).padStart(2, '0')})`);

        // Set null for future slots (beyond lastDataSlot for today)
        if (isToday) {
            for (let i = lastDataSlot + 1; i < 288; i++) {
                pvData[i] = null;
                batData[i] = null;
                loadData[i] = null;
                gridData[i] = null;
            }
        }

        // Count non-null values for logging
        const nonNullCount = pvData.filter(v => v !== null).length;
        console.log(`📊 Cloud data converted: ${timeline.length} points -> ${nonNullCount} chart slots`);
        console.log("📊 Sample data - PV max:", Math.max(...pvData.filter(v => v !== null && v > 0), 0), "Load max:", Math.max(...loadData.filter(v => v !== null && v > 0), 0));

        // Update peak stats from Cloud data (timeline format)
        const filteredTimeline = timeline.filter((point, index) => {
            let slotIndex;
            const timeStr = point.t || point.time;
            if (timeStr && timeStr.includes(':') && timeStr.length <= 5) {
                const parts = timeStr.split(':');
                slotIndex = parseInt(parts[0], 10) * 12 + Math.floor(parseInt(parts[1], 10) / 5);
            } else {
                slotIndex = index;
            }
            return slotIndex <= maxAllowedSlot;
        });
        updateEnergyChartPeakStatsFromTimeline(filteredTimeline);

        // Cache timeline data for all charts
        cachedChartData = timeline;
        console.log('💾 Timeline data cached for all charts:', timeline.length, 'points');

        // NEW: Update Power Timeline Chart with full data
        updatePowerTimelineChart(timeline, cloudData.date);

        // Render the currently active chart
        switch (activeChartNumber) {
            case 2:
                renderGridSourceChart(timeline);
                break;
            case 3:
                renderPVTodayChart(timeline);
                break;
            case 4:
                renderBatteryFlowChart(timeline);
                break;
        }
    }

    // Update peak stats from Cloud Power History (timeline array format)
    // RENAMED to avoid conflict with updateEnergyChartPeakStats(labels, processedData)
    function updateEnergyChartPeakStatsFromTimeline(timeline) {
        if (!timeline || timeline.length === 0) return;

        // Find peak values and times
        let maxPv = 0, maxPvTime = '--:--';
        let maxCharge = 0, maxChargeTime = '--:--';
        let maxDischarge = 0, maxDischargeTime = '--:--';
        let maxLoad = 0, maxLoadTime = '--:--';
        let maxGrid = 0, maxGridTime = '--:--';

        // Format time: handle "t" (HH:mm), "time" (ISO or HH:mm)
        const getTimeStr = (point) => {
            // Worker format: point.t = "HH:mm"
            if (point.t) return point.t;
            // Legacy format: point.time
            if (!point.time) return '--:--';
            if (point.time.includes(':') && point.time.length <= 5) {
                return point.time;
            }
            // ISO format
            const d = new Date(point.time);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };

        timeline.forEach(point => {
            const timeStr = getTimeStr(point);

            // Support multiple API formats:
            // - Worker: { t, pv, bat, load, grid, backup }
            // - Railway: { time, pvPower, batteryPower, loadPower, gridPower }
            // - Legacy: { time, pv, battery, load, grid }
            const pv = point.pvPower ?? point.pv ?? 0;
            const battery = point.batteryPower ?? point.bat ?? point.battery ?? 0;
            const load = point.loadPower ?? point.load ?? 0;
            const grid = point.gridPower ?? point.grid ?? 0;

            // PV
            if (pv > maxPv) {
                maxPv = pv;
                maxPvTime = timeStr;
            }
            // Battery charge (positive battery = charging)
            if (battery > 0 && battery > maxCharge) {
                maxCharge = battery;
                maxChargeTime = timeStr;
            }
            // Battery discharge (negative battery = discharging)
            if (battery < 0 && Math.abs(battery) > maxDischarge) {
                maxDischarge = Math.abs(battery);
                maxDischargeTime = timeStr;
            }
            // Load
            if (load > maxLoad) {
                maxLoad = load;
                maxLoadTime = timeStr;
            }
            // Grid
            if (grid > maxGrid) {
                maxGrid = grid;
                maxGridTime = timeStr;
            }
        });

        // Update UI elements
        const updateEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        updateEl('chart-pv-peak', maxPv > 0 ? `${Math.round(maxPv)} W` : '--');
        updateEl('chart-pv-time', maxPvTime);
        updateEl('chart-charge-peak', maxCharge > 0 ? `${Math.round(maxCharge)} W` : '--');
        updateEl('chart-charge-time', maxChargeTime);
        updateEl('chart-discharge-peak', maxDischarge > 0 ? `${Math.round(maxDischarge)} W` : '--');
        updateEl('chart-discharge-time', maxDischargeTime);
        updateEl('chart-load-peak', maxLoad > 0 ? `${Math.round(maxLoad)} W` : '--');
        updateEl('chart-load-time', maxLoadTime);
        updateEl('chart-grid-peak', maxGrid > 0 ? `${Math.round(maxGrid)} W` : '--');
        updateEl('chart-grid-time', maxGridTime);

        console.log("📊 Peak stats updated from LightEarth Cloud:", {
            pv: `${maxPv}W @ ${maxPvTime}`,
            charge: `${maxCharge}W @ ${maxChargeTime}`,
            discharge: `${maxDischarge}W @ ${maxDischargeTime}`,
            load: `${maxLoad}W @ ${maxLoadTime}`,
            grid: `${maxGrid}W @ ${maxGridTime}`
        });
    }

    // Helper function to update summary stats from Lightearth data
    function updateSummaryFromLightearthData(data) {
        const { batData, pvData, otherData } = data;

        // Extract values (unit: 0.1 kWh, so divide by 10)
        const batCharge = (batData.data?.bats?.[0]?.tableValue || 0) / 10;
        const batDischarge = (batData.data?.bats?.[1]?.tableValue || 0) / 10;
        const pvTotal = (pvData.data?.pv?.tableValue || 0) / 10;
        const loadTotal = (otherData.data?.homeload?.tableValue || 0) / 10;
        const gridTotal = (otherData.data?.grid?.tableValue || 0) / 10;
        const essentialTotal = (otherData.data?.essentialLoad?.tableValue || 0) / 10;

        // Update summary stats
        updateValue('pv-total', pvTotal.toFixed(1) + ' kWh');
        updateValue('load-total', loadTotal.toFixed(1) + ' kWh');
        updateValue('grid-total', gridTotal.toFixed(1) + ' kWh');
        updateValue('essential-total', essentialTotal.toFixed(1) + ' kWh');
        updateValue('bat-charge', batCharge.toFixed(1) + ' kWh');
        updateValue('bat-discharge', batDischarge.toFixed(1) + ' kWh');

        console.log("✅ Summary stats updated from Lightearth:", {
            pv: pvTotal, load: loadTotal, grid: gridTotal,
            essential: essentialTotal, batCharge, batDischarge
        });

        // Get current time slot - for TODAY, we limit data to current time
        const now = new Date();
        const currentSlot = now.getHours() * 12 + Math.floor(now.getMinutes() / 5);
        const queryDate = document.getElementById('dateInput')?.value;
        const todayStr = now.toISOString().split('T')[0];
        const isToday = queryDate === todayStr;
        const maxAllowedSlot = isToday ? currentSlot : 287;

        console.log(`📊 Lightearth data: isToday=${isToday}, maxAllowedSlot=${maxAllowedSlot}`);

        // Get raw data arrays
        let pvArr = pvData.data?.pv?.tableValueInfo || [];
        let batArr = batData.data?.tableValueInfo || [];
        let loadArr = otherData.data?.homeload?.tableValueInfo || [];
        let gridArr = otherData.data?.grid?.tableValueInfo || [];
        let essentialArr = otherData.data?.essentialLoad?.tableValueInfo || [];

        // Truncate data beyond current time (for today) - set future slots to null
        if (isToday && pvArr.length > 0) {
            pvArr = pvArr.map((v, i) => i <= maxAllowedSlot ? v : null);
            batArr = batArr.map((v, i) => i <= maxAllowedSlot ? v : null);
            loadArr = loadArr.map((v, i) => i <= maxAllowedSlot ? v : null);
            gridArr = gridArr.map((v, i) => i <= maxAllowedSlot ? v : null);
            essentialArr = essentialArr.map((v, i) => i <= maxAllowedSlot ? v : null);
            console.log(`📊 Truncated Lightearth data to slot ${maxAllowedSlot}`);
        }

        // Update combined energy chart with raw data
        const chartData = {
            pv: { tableValueInfo: pvArr },
            bat: { tableValueInfo: batArr },
            load: { tableValueInfo: loadArr },
            grid: { tableValueInfo: gridArr },
            essentialLoad: { tableValueInfo: essentialArr }
        };
        console.log("📊 Updating combined energy chart with Lightearth data");
        updateCharts(chartData);

        // NOTE: Realtime display will NOT be updated from day data
        // Only show real values when system realtime data is available
        // Day data is historical - not suitable for "Luồng năng lượng thời gian thực"
        console.log("📊 Day data loaded - Realtime display will show empty until system data arrives");
    }

    // Temperature cache - 5 minute TTL to reduce API calls
    const TEMPERATURE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    // temperatureCache is now declared at top level to avoid TDZ

    // Fetch Temperature Min/Max for the day from Cloud API
    // Uses 5-minute cache to prevent excessive API calls
    async function fetchTemperatureMinMax(deviceId, date) {
        const queryDate = date || document.getElementById('dateInput')?.value || new Date().toISOString().split('T')[0];
        const now = Date.now();

        // Check cache - use cached data if valid (same device, same date, not expired)
        if (temperatureCache.deviceId === deviceId &&
            temperatureCache.date === queryDate &&
            temperatureCache.data &&
            (now - temperatureCache.timestamp) < TEMPERATURE_CACHE_TTL) {

            const cacheAge = Math.round((now - temperatureCache.timestamp) / 1000);
            console.log(`🌡️ Using cached temperature data (age: ${cacheAge}s, TTL: 5min)`);
            applyTemperatureData(temperatureCache.data);
            return;
        }

        // Fetch fresh data
        console.log(`🌡️ Fetching fresh temperature data...`);

        try {
            const response = await fetchWithProxyFallback(
                () => LIGHTEARTH_API.cloudTemperature(deviceId, queryDate)
            );
            const data = await response.json();
            console.log("🌡️ Temperature min/max data received:", data);

            // Cache the data
            if (data.success) {
                temperatureCache = {
                    deviceId: deviceId,
                    date: queryDate,
                    data: data,
                    timestamp: now
                };
                console.log('💾 Temperature data cached (TTL: 5 minutes)');
            }

            applyTemperatureData(data);
        } catch (error) {
            console.warn("🌡️ Temperature API unavailable:", error.message);
            // Hide the badge if API fails and no cache
            if (!temperatureCache.data) {
                const badge = document.getElementById('tempMinMaxBadge');
                if (badge) badge.classList.add('hidden');
            }
        }
    }

    // Apply temperature data to UI
    function applyTemperatureData(data) {
        const badge = document.getElementById('tempMinMaxBadge');
        const minEl = document.getElementById('temp-min-value');
        const maxEl = document.getElementById('temp-max-value');

        if (badge && data && data.success && data.min !== null && data.max !== null) {
            minEl.textContent = `${data.min}°C`;
            maxEl.textContent = `${data.max}°C`;
            // Add time tooltips if available
            if (data.minTime) minEl.title = `Thấp nhất lúc ${data.minTime}`;
            if (data.maxTime) maxEl.title = `Cao nhất lúc ${data.maxTime}`;
            badge.classList.remove('hidden');
            badge.classList.add('flex');
            console.log(`✅ Temperature: ${data.min}°C (${data.minTime}) - ${data.max}°C (${data.maxTime})`);

            // Also update current temperature from synced data
            if (data.current !== null && data.current !== undefined) {
                updateValue('device-temp', `${data.current}°C`);
                updateValue('device-temp-info', `${data.current}°C`);
            }
        } else {
            console.warn("⚠️ Temperature data not available or invalid");
            if (badge) badge.classList.add('hidden');
        }
    }

    // ========================================
    // DEVICE INFO - Get inverter model from Cloud API
    // With localStorage caching (24h TTL) to reduce API calls
    // ========================================

    // Device info cache TTL: 24 hours (model/firmware rarely changes)
    const DEVICE_INFO_CACHE_TTL = 24 * 60 * 60 * 1000;

    function fetchDeviceInfo(deviceId) {
        if (!deviceId) return;

        // Check localStorage cache first
        const cacheKey = `deviceInfo_${deviceId}`;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const cachedData = JSON.parse(cached);
                const cacheAge = Date.now() - cachedData.timestamp;

                // Use cache if not expired (24 hours)
                if (cacheAge < DEVICE_INFO_CACHE_TTL) {
                    console.log(`📦 Using cached device info for ${deviceId} (age: ${Math.round(cacheAge / 60000)} min)`);
                    applyDeviceInfo(cachedData.model);
                    return;
                } else {
                    console.log(`📦 Device info cache expired for ${deviceId}, fetching fresh data`);
                }
            } catch (e) {
                console.warn('📦 Invalid cache data, fetching fresh');
            }
        }

        console.log(`📦 Fetching device info...`);

        fetchWithProxyFallback(() => LIGHTEARTH_API.cloudDeviceInfo(deviceId))
            .then(response => response.json())
            .then(data => {
                console.log("📦 Device info received:", data);

                if (data.success) {
                    // Extract model from friendly_name (e.g., "SUNT-4.0kW-H PV Power" -> "SUNT-4.0kW-H")
                    let model = null;

                    if (data.friendly_name) {
                        // Parse friendly_name to extract model (usually "MODEL SENSOR_TYPE")
                        // Examples: "SUNT-4.0kW-H PV Power", "SUNT-8.0kW-T Battery SOC"
                        const friendlyName = data.friendly_name;
                        const modelMatch = friendlyName.match(/^(SUNT-[\d.]+kW-[A-Z]+)/i);
                        if (modelMatch) {
                            model = modelMatch[1];
                        } else {
                            // Fallback: Take first part before common sensor names
                            const sensorNames = ['PV Power', 'Battery', 'Grid', 'Load', 'SOC', 'Temperature'];
                            for (const sensorName of sensorNames) {
                                if (friendlyName.includes(sensorName)) {
                                    model = friendlyName.split(sensorName)[0].trim();
                                    break;
                                }
                            }
                        }
                    }

                    // Fallback to model field if available
                    if (!model && data.model) {
                        model = data.model;
                    }

                    // Cache to localStorage with timestamp
                    if (model) {
                        try {
                            localStorage.setItem(cacheKey, JSON.stringify({
                                model: model,
                                timestamp: Date.now(),
                                raw: data
                            }));
                            console.log(`💾 Device info cached for ${deviceId}: ${model}`);
                        } catch (e) {
                            console.warn('📦 Could not cache device info:', e.message);
                        }
                    }

                    applyDeviceInfo(model);
                }
            })
            .catch(error => {
                console.warn("📦 Device info API unavailable (all proxies failed):", error.message);
                // Try to use expired cache as fallback
                if (cached) {
                    try {
                        const cachedData = JSON.parse(cached);
                        console.log(`📦 Using expired cache as fallback for ${deviceId}`);
                        applyDeviceInfo(cachedData.model);
                    } catch (e) {
                        // Ignore
                    }
                }
            });
    }

    // Helper function to apply device info to UI
    function applyDeviceInfo(model) {
        if (!model) return;

        const deviceTypeEl = document.getElementById('device-type');
        const inverterTypeEl = document.getElementById('inverter-type');
        const inverterTypeBasicEl = document.getElementById('inverter-type-basic');

        if (deviceTypeEl) deviceTypeEl.textContent = model;
        if (inverterTypeEl) inverterTypeEl.textContent = model;
        if (inverterTypeBasicEl) inverterTypeBasicEl.textContent = model;
        console.log(`✅ Device type updated: ${model}`);
    }

    // ========================================
    // SOC CHART V5 - Clean Implementation
    // API: Railway SOC History (LightEarth Cloud data)
    // ========================================

    // SOC Chart variables - socChartInstance, socData, socAutoReloadInterval are now at top level

    // SOC data cache - 5 minute TTL to reduce API calls
    const SOC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    // socCache is now declared at top level to avoid TDZ

    // Fetch SOC data from Railway API (LightEarth Cloud data only)
    // Uses 5-minute cache to prevent excessive API calls
    async function fetchSOCData() {
        console.log('🔋 fetchSOCData() called');

        // Get deviceId from input or URL parameter
        const inputDeviceId = document.getElementById('deviceId')?.value?.trim();
        const urlDeviceId = new URLSearchParams(window.location.search).get('deviceId');
        const deviceId = inputDeviceId || urlDeviceId;

        if (!deviceId) {
            console.error('❌ SOC fetch ABORTED: No deviceId');
            return;
        }

        // Get date from dateInput (format: YYYY-MM-DD), default to today
        const dateInput = document.getElementById('dateInput')?.value;
        const date = dateInput || new Date().toISOString().split('T')[0];
        const now = Date.now();

        // Check cache - use cached data if valid (same device, same date, not expired)
        if (socCache.deviceId === deviceId &&
            socCache.date === date &&
            socCache.data &&
            (now - socCache.timestamp) < SOC_CACHE_TTL) {

            const cacheAge = Math.round((now - socCache.timestamp) / 1000);
            console.log(`🔋 Using cached SOC data (age: ${cacheAge}s, TTL: 5min, points: ${socCache.data.timeline?.length || 0})`);

            // Apply cached data
            if (socCache.data.timeline && socCache.data.timeline.length > 0) {
                socData = socCache.data.timeline;
                renderSOCChart();
                updateLastFetchTime();
                startSOCAutoReload();
            }
            return;
        }

        // Fetch fresh data (with fallback support)
        const socUrl = getSocApiUrl(deviceId, date) + `&_t=${now}`;

        let data = null;
        console.log('🔋 Fetching fresh SOC data from:', socUrl);

        try {
            const response = await fetch(socUrl, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (response.ok) {
                data = await response.json();

                if (data.success && data.timeline && data.timeline.length > 0) {
                    console.log(`✅ SOC API success: ${data.timeline.length} points`);

                    // Cache the data
                    socCache = {
                        deviceId: deviceId,
                        date: date,
                        data: data,
                        timestamp: now
                    };
                    console.log('💾 SOC data cached (TTL: 5 minutes)');
                } else if (data.error) {
                    console.warn(`⚠️ SOC API error: ${data.error}`);
                    data = null;
                } else {
                    console.warn(`⚠️ SOC API: no data for ${deviceId}`);
                    data = null;
                }
            } else {
                console.warn(`⚠️ SOC API HTTP error: ${response.status}`);
            }
        } catch (error) {
            console.warn(`⚠️ SOC API failed: ${error.message}`);
        }

        // Process data
        if (data && data.timeline && Array.isArray(data.timeline) && data.timeline.length > 0) {
            socData = data.timeline;
            // Store API-calculated min/max (more accurate, filters sensor glitches)
            socApiStats = {
                min: data.min,
                max: data.max,
                minTime: data.minTime,
                maxTime: data.maxTime
            };
            renderSOCChart();
            updateSOCLastTime('LightEarth Cloud');
            startSOCAutoReload();
            console.log(`✅ [SOC] Chart rendered with ${socData.length} points, API min=${data.min}%, max=${data.max}%`);
        } else {
            console.warn(`⚠️ [SOC] No data available for ${deviceId} on ${date}`);
            socData = [];
            socApiStats = { min: null, max: null, minTime: null, maxTime: null };
            renderSOCChartEmpty();
        }
    }

    // Render empty state for SOC chart
    function renderSOCChartEmpty() {
        const canvas = document.getElementById('socChart');
        if (!canvas) return;

        // Destroy existing chart
        if (socChartInstance) {
            socChartInstance.destroy();
            socChartInstance = null;
        }

        // Update displays with empty values
        const bigValue = document.getElementById('soc-big-value');
        const maxEl = document.getElementById('soc-max');
        const minEl = document.getElementById('soc-min');

        if (bigValue) bigValue.textContent = '--%';
        if (maxEl) maxEl.textContent = '--%';
        if (minEl) minEl.textContent = '--%';
    }

    // Render SOC Chart with Chart.js and external tooltip
    function renderSOCChart() {
        console.log('🎨🎨🎨 renderSOCChart CALLED, socData length:', socData.length);

        const canvas = document.getElementById('socChart');
        if (!canvas) {
            console.error('❌ [SOC] Canvas element not found!');
            return;
        }
        if (socData.length === 0) {
            console.warn('⚠️ [SOC] No data to render');
            return;
        }

        // Check if canvas is visible - if not, retry after short delay
        const rect = canvas.getBoundingClientRect();
        console.log('📐 [SOC] Canvas rect:', rect.width, 'x', rect.height);

        if (rect.width === 0 || rect.height === 0) {
            console.warn('⚠️ [SOC] Canvas not visible, retrying in 200ms...');
            setTimeout(() => renderSOCChart(), 200);
            return;
        }

        // Destroy existing chart
        if (socChartInstance) {
            console.log('🗑️ [SOC] Destroying existing chart instance');
            socChartInstance.destroy();
            socChartInstance = null;
        }

        // Prepare data
        // API returns {time, value} format - convert to chart format
        const labels = socData.map(d => {
            if (d.t) return d.t;  // Already formatted
            if (d.time) {
                const date = new Date(d.time);
                return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            }
            return '';
        });
        const values = socData.map(d => d.soc !== undefined ? d.soc : (d.value !== undefined ? d.value : 0));

        // Use API-calculated min/max if available (more accurate, filters sensor glitches)
        // Otherwise fallback to local calculation
        let maxSOC, minSOC;
        if (socApiStats.min !== null && socApiStats.max !== null) {
            maxSOC = socApiStats.max;
            minSOC = socApiStats.min;
            console.log(`📊 [SOC] Using API stats: min=${minSOC}%, max=${maxSOC}%`);
        } else {
            // Fallback: filter out values <= 1% as likely sensor glitches (0, 1%)
            // Valid range is 2-100% for MIN calculation
            const validValues = values.filter(v => v !== null && v !== undefined && v > 1);
            maxSOC = validValues.length > 0 ? Math.max(...validValues) : 0;
            minSOC = validValues.length > 0 ? Math.min(...validValues) : 0;
            console.log(`📊 [SOC] Using local stats (filtered >1%): min=${minSOC}%, max=${maxSOC}%`);
        }
        const currentSOC = values[values.length - 1] || 0;
        const currentData = socData[socData.length - 1];

        // Update displays
        const bigValue = document.getElementById('soc-big-value');
        const maxEl = document.getElementById('soc-max');
        const minEl = document.getElementById('soc-min');

        if (bigValue) bigValue.textContent = `${currentSOC}%`;
        if (maxEl) maxEl.textContent = `${maxSOC}%`;
        if (minEl) minEl.textContent = `${minSOC}%`;

        // Create gradient
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, 'rgba(20, 184, 166, 0.4)');
        gradient.addColorStop(1, 'rgba(20, 184, 166, 0.02)');

        // Use Chart.js built-in tooltip (better edge handling than external)

        socChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'SOC (%)',
                    data: values,
                    borderColor: 'rgb(20, 184, 166)',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 12,
                    pointHoverBackgroundColor: 'rgb(20, 184, 166)',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                onHover: (event, elements) => {
                    if (elements.length) {
                        console.log('🔔 SOC chart hover - triggering haptic');
                        triggerHaptic();
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        position: 'topRight',
                        enabled: true,
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#14b8a6',
                        bodyColor: '#f1f5f9',
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 16, weight: 'bold' },
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        mode: 'nearest',
                        intersect: false,
                        axis: 'x',
                        callbacks: {
                            title: (items) => `⏰ ${items[0].label}`,
                            label: (context) => `🔋 ${context.parsed.y}%`
                        }
                    }
                },
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(148, 163, 184, 0.1)', drawBorder: false },
                        ticks: {
                            callback: v => `${v}%`,
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)',
                            stepSize: 25
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 9 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8
                        }
                    }
                },
                interaction: {
                    mode: 'nearest',
                    intersect: false,
                    axis: 'x'
                },
                hover: {
                    mode: 'nearest',
                    intersect: false,
                    animationDuration: 0
                },
                events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend']
            }
        });

        console.log('✅ SOC Chart rendered with built-in tooltip');

        console.log('✅ SOC Chart rendered with enhanced touch support');

        // Direct touch event for haptic - ensures it works on first load
        canvas.addEventListener('touchmove', () => triggerHaptic(), { passive: true });
        canvas.addEventListener('mousemove', () => triggerHaptic());
    }

    // Update current values (latest data point) - no-op after removing power cards
    function updateSOCCurrentValues() {
        // Power cards removed - nothing to update
    }

    // Update last fetch time (no source info displayed)
    function updateSOCLastTime(source = '') {
        const el = document.getElementById('soc-last-update');
        if (el) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            el.textContent = `Cập nhật: ${timeStr}`;
        }
    }

    // Start SOC auto-reload (every 5 minutes)
    function startSOCAutoReload() {
        if (socAutoReloadInterval) clearInterval(socAutoReloadInterval);
        socAutoReloadInterval = setInterval(() => {
            fetchSOCData();
        }, 5 * 60 * 1000);
        console.log('🔄 SOC auto-reload started (every 5 minutes)');
    }

    function showCompactSearchBar(deviceId, date) {
        // Hide hero section and show compact bar
        const heroSection = document.getElementById('heroSection');
        const compactSearch = document.getElementById('compactSearch');
        const deviceIdDisplay = document.getElementById('deviceIdDisplay');
        const dateDisplay = document.getElementById('dateDisplay');
        const compactDateDisplay = document.getElementById('compactDateDisplay');
        const compactDateInput = document.getElementById('compactDateInput');

        if (heroSection) {
            heroSection.classList.add('hidden');
        }
        if (compactSearch) {
            compactSearch.classList.remove('hidden');
        }
        if (deviceIdDisplay) {
            deviceIdDisplay.textContent = deviceId;
        }
        if (dateDisplay) {
            const dateObj = new Date(date);
            dateDisplay.textContent = dateObj.toLocaleDateString('vi-VN');
        }
        // Update compact date display (DD/MM/YYYY format)
        if (compactDateDisplay && date) {
            const dateObj = new Date(date);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            compactDateDisplay.textContent = `${day}/${month}/${year}`;
        }
        // Sync compact date input value
        if (compactDateInput && date) {
            compactDateInput.value = date;
        }
    }

    // ========================================
    // DATA PROCESSING
    // ========================================

    function processData(data) {
        // Show all sections including batteryCellSection
        showElement('deviceInfo');
        showElement('summaryStats');
        showElement('chart-section');
        showElement('realTimeFlow');
        showElement('batteryCellSection'); // Always show, will display waiting message

        // Reset cell data state for new device
        hasCellData = false;
        cellDataReceived = false;

        // Update device info
        updateDeviceInfo(data.deviceInfo);

        // Update summary stats (convert from 0.1kWh to kWh)
        updateValue('pv-total', ((data.pv?.tableValue || 0) / 10).toFixed(1) + ' kWh');
        // Use chargeKwh/dischargeKwh from proxy API, fallback to bats[] for old API
        const batCharge = data.bat?.chargeKwh ?? ((data.bat?.bats?.[0]?.tableValue || 0) / 10);
        const batDischarge = data.bat?.dischargeKwh ?? ((data.bat?.bats?.[1]?.tableValue || 0) / 10);
        updateValue('bat-charge', batCharge.toFixed(1) + ' kWh');
        updateValue('bat-discharge', batDischarge.toFixed(1) + ' kWh');
        updateValue('load-total', ((data.load?.tableValue || 0) / 10).toFixed(1) + ' kWh');
        updateValue('grid-total', ((data.grid?.tableValue || 0) / 10).toFixed(1) + ' kWh');
        updateValue('essential-total', ((data.essentialLoad?.tableValue || 0) / 10).toFixed(1) + ' kWh');

        // Update charts
        updateCharts(data);

        // Initialize battery cells with waiting message (no mock data)
        initializeBatteryCellsWaiting();

        // SOC chart is now handled by fetchSOCData() with auto-reload
    }

    function updateDeviceInfo(deviceInfo) {
        let deviceText = deviceInfo.deviceId;
        if (deviceInfo.remarkName && deviceInfo.remarkName.length > 0) {
            deviceText += " - " + deviceInfo.remarkName;
        }

        updateValue('device-id', deviceText.substring(0, 40));
        updateValue('device-type', deviceInfo.deviceType);
        updateValue('inverter-type', deviceInfo.deviceType);
        updateValue('device-status', deviceInfo.onlineStatus === 1 ? 'Online' : 'Offline');

        // Update status color
        const statusEl = document.getElementById('device-status');
        if (statusEl) {
            if (deviceInfo.onlineStatus === 1) {
                statusEl.className = 'text-green-600 dark:text-green-400 font-semibold';
            } else {
                statusEl.className = 'text-red-600 dark:text-red-400 font-semibold';
            }
        }
    }

    // ========================================
    // REAL-TIME DISPLAY UPDATE
    // ========================================

    // deviceNotFoundShown is now declared at top level to avoid TDZ

    function updateRealTimeDisplay(data) {
        // Check if device not found in LightEarth Cloud
        if (data.deviceNotFound) {
            // Only show error once, then keep previous values
            if (!deviceNotFoundShown) {
                updateValue('pv-power', 'N/A');
                updateValueHTML('pv-desc', `<span class="text-red-400 text-xs">⏳ Đang kết nối thiết bị...</span>`);

                updateValue('grid-power', 'N/A');
                updateValue('grid-voltage', 'N/A');

                updateValue('battery-percent-icon', 'N/A');
                updateValueHTML('battery-status-text', `<span class="text-red-400">Không tìm thấy</span>`);
                updateValueHTML('battery-power', `<span class="text-red-400">--</span>`);
                updateValue('batteryVoltageDisplay', '--');

                updateValue('device-temp', 'N/A');
                updateValue('device-temp-info', '--');
                updateValue('essential-power', 'N/A');
                updateValue('load-power', 'N/A');
                updateValue('acout-power', 'N/A');

                console.error(`❌ Device not found: ${data.errorMessage}`);
                deviceNotFoundShown = true;
            }
            return;
        }

        // Reset flag when device is found
        deviceNotFoundShown = false;

        // Check if we have NO realtime data (all values are null)
        const noData = data.noRealtimeData || (data.pvTotalPower === null && data.gridValue === null);

        if (noData) {
            // KEEP OLD VALUES - don't clear to N/A or --
            // Just log and wait for next data fetch
            console.log("⏳ Realtime: No new data - keeping previous values, waiting for next fetch...");
            return;
        }

        // Normal update with actual data
        // PV - with blink effect
        updateValue('pv-power', `${data.pvTotalPower}W`);

        // Show/hide suns based on PV power level
        // 1-2000W: 1 sun, 2001-3000W: 2 suns, 3001+W: 3 suns
        const sun1 = document.getElementById('sun-1');
        const sun2 = document.getElementById('sun-2');
        const sun3 = document.getElementById('sun-3');
        const pvPower = data.pvTotalPower || 0;

        if (pvPower >= 1) {
            sun1?.classList.add('visible');
        } else {
            sun1?.classList.remove('visible');
        }

        if (pvPower > 2000) {
            sun2?.classList.add('visible');
        } else {
            sun2?.classList.remove('visible');
        }

        if (pvPower > 3000) {
            sun3?.classList.add('visible');
        } else {
            sun3?.classList.remove('visible');
        }
        if (data.pv2Power) {
            // Compact format without S1:/S2: labels - W to hơn, V nhỏ hơn
            updateValueHTML('pv-desc', `
                <span class="font-black text-xs sm:text-sm">${data.pv1Power}W</span> 
                <span class="text-[10px] sm:text-[11px] opacity-70">${data.pv1Voltage}V</span> 
                <span class="opacity-50 mx-0.5">|</span> 
                <span class="font-black text-xs sm:text-sm">${data.pv2Power}W</span> 
                <span class="text-[10px] sm:text-[11px] opacity-70">${data.pv2Voltage}V</span>
            `);
        } else {
            updateValue('pv-desc', `${data.pv1Voltage}V`);
        }

        // Grid - with blink effect
        updateValue('grid-power', `${data.gridValue}W`);
        updateValue('grid-voltage', `${data.gridVoltageValue}V`);

        // EVN Electric Spark Animation - activate when |gridPower| > 20W
        const evnSpark = document.getElementById('evn-spark');
        const evnSparkBasic = document.getElementById('evn-spark-basic');
        const gridAbsValue = Math.abs(data.gridValue || 0);
        if (gridAbsValue > 20) {
            evnSpark?.classList.add('active');
            evnSparkBasic?.classList.add('active');
        } else {
            evnSpark?.classList.remove('active');
            evnSparkBasic?.classList.remove('active');
        }

        // Battery
        const batteryPercent = data.batteryPercent || 0;

        // Update battery percent display in icon - with blink
        updateValue('battery-percent-icon', `${batteryPercent}%`);

        // Update battery fill level - horizontal bar like phone battery
        const batteryFill = document.getElementById('battery-fill');
        if (batteryFill) {
            batteryFill.style.width = `${batteryPercent}%`;
            // Change color based on level: Red 0-20%, Yellow 21-50%, Emerald 51-100%
            if (batteryPercent <= 20) {
                batteryFill.className = 'absolute left-0 top-0 bottom-0 bg-red-500 transition-all duration-500';
            } else if (batteryPercent <= 50) {
                batteryFill.className = 'absolute left-0 top-0 bottom-0 bg-yellow-500 transition-all duration-500';
            } else {
                batteryFill.className = 'absolute left-0 top-0 bottom-0 bg-emerald-500 transition-all duration-500';
            }
        }

        // Update battery status text - with blink
        if (data.batteryStatus === "Discharging") {
            updateValueHTML('battery-status-text', `<span class="text-orange-500">Đang xả</span>`);
        } else if (data.batteryStatus === "Charging") {
            updateValueHTML('battery-status-text', `<span class="text-emerald-500">Đang sạc</span>`);
        } else {
            updateValueHTML('battery-status-text', `<span class="text-emerald-400">Chờ</span>`);
        }

        // Battery power - with blink
        if (data.batteryStatus === "Discharging") {
            updateValueHTML('battery-power', `<span class="text-red-600 dark:text-red-400">-${Math.abs(data.batteryValue)}W</span>`);
        } else {
            updateValueHTML('battery-power', `<span class="text-green-600 dark:text-green-400">+${Math.abs(data.batteryValue)}W</span>`);
        }

        // Battery Voltage (Điện Áp Pin) - display in ALL views (Pro, Basic, 3D Home, Cell section)
        if (data.batteryVoltage) {
            const voltageStr = `${data.batteryVoltage.toFixed(1)}V`;
            // Cell section display (original)
            updateValue('batteryVoltageDisplay', voltageStr);
            // Pro view - voltage under battery power
            updateValue('battery-voltage-pro', voltageStr);
            // Basic view - voltage under battery power
            updateValue('battery-voltage-basic', voltageStr);
            // 3D Home view - voltage under battery power
            updateValue('battery-voltage-3d', voltageStr);
        }

        // Battery Current (Dòng điện Pin) - display in ALL views (Pro, Basic, 3D Home)
        // Show + when charging, - when discharging
        const batteryCurrent = data.batteryCurrent || 0;
        const batteryPowerForSign = data.batteryValue || 0;
        let currentStr;
        if (batteryPowerForSign > 0) {
            // Charging - show positive
            currentStr = `+${Math.abs(batteryCurrent).toFixed(1)}A`;
        } else if (batteryPowerForSign < 0) {
            // Discharging - show negative
            currentStr = `-${Math.abs(batteryCurrent).toFixed(1)}A`;
        } else {
            // Idle
            currentStr = `${Math.abs(batteryCurrent).toFixed(1)}A`;
        }
        updateValue('battery-current-pro', currentStr);
        updateValue('battery-current-basic', currentStr);
        updateValue('battery-current-3d', currentStr);

        // Other values - with blink effect
        updateValue('device-temp', `${data.deviceTempValue}°C`);
        updateValue('device-temp-info', `${data.deviceTempValue}°C`); // Also update header temp
        updateValue('essential-power', `${data.essentialValue}W`);
        updateValue('load-power', `${data.loadValue}W`);

        // Update AC Out power (from inverterAcOutPower)
        if (data.inverterAcOutPower !== undefined) {
            updateValue('acout-power', `${data.inverterAcOutPower}W`);
        }

        // Update flow statuses
        updateFlowStatus('pv-flow', data.pvTotalPower > 0);
        updateFlowStatus('grid-flow', data.gridValue > 0);
        updateFlowStatus('battery-flow', data.batteryValue !== 0);
        updateFlowStatus('essential-flow', data.essentialValue > 0);
        updateFlowStatus('load-flow', data.loadValue > 0);

        // Update energy flow animation dots
        updateEnergyFlowAnimation(data);

        // Auto-sync to Basic view if it's visible
        console.log('🔄 Syncing views - Basic:', typeof window.autoSyncBasicView, '3D:', typeof window.autoSync3DHomeView);
        if (typeof window.autoSyncBasicView === 'function') {
            window.autoSyncBasicView();
        }

        // Auto-sync to 3D Home view if it's visible
        if (typeof window.autoSync3DHomeView === 'function') {
            window.autoSync3DHomeView();
        }

        // Update last refresh time with blink
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        updateValue('lastUpdateTime', `Cập nhật: ${timeStr}`);

        // SOC chart is updated from API via fetchSOCData() with auto-reload
    }

    // ========================================
    // BATTERY CELL DISPLAY
    // ========================================

    // Fetch battery cells specifically from lightearth-proxy (which always has cells data)
    // This is needed because applike098 API doesn't return cells data
    // LIGHTEARTH_PROXY_API, lastCellsFetch and CELLS_FETCH_INTERVAL are now at top level to avoid TDZ

    async function fetchBatteryCellsFromProxy(deviceId) {
        // Throttle fetches to prevent spam
        const now = Date.now();
        if (now - lastCellsFetch < CELLS_FETCH_INTERVAL) {
            console.log('🔋 Cells fetch throttled, skipping...');
            return;
        }
        lastCellsFetch = now;

        try {
            const cellsUrl = `${LIGHTEARTH_PROXY_API}/api/realtime/device/${deviceId}`;
            console.log('🔋 Fetching cells from proxy:', cellsUrl);

            const response = await fetch(cellsUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const cellsData = data.deviceData?.battery?.cells;

            if (cellsData && cellsData.cells) {
                console.log('✅ [Proxy] Got cells data:', cellsData);

                // Process cells data
                const cellKeys = Object.keys(cellsData.cells).sort((a, b) => {
                    const numA = parseInt(a.replace(/\D/g, ''));
                    const numB = parseInt(b.replace(/\D/g, ''));
                    return numA - numB;
                });

                const cellVoltages = [];
                cellKeys.forEach((key) => {
                    cellVoltages.push(cellsData.cells[key]);
                });

                if (cellVoltages.length > 0) {
                    const validVoltages = cellVoltages.filter(v => v > 0);
                    const cellData = {
                        cells: cellVoltages,
                        maximumVoltage: cellsData.max || Math.max(...validVoltages, 0),
                        minimumVoltage: cellsData.min || Math.min(...validVoltages.filter(v => v > 0), 0),
                        averageVoltage: cellsData.avg || (validVoltages.length > 0 ? validVoltages.reduce((a, b) => a + b, 0) / validVoltages.length : 0),
                        numberOfCells: cellVoltages.length
                    };
                    updateBatteryCellDisplay(cellData);
                    console.log(`✅ [Proxy] Cell voltages updated: ${cellVoltages.length} cells`);
                }
            } else {
                console.warn('⚠️ [Proxy] No cells data in response');
            }
        } catch (error) {
            console.warn('⚠️ [Proxy] Cells fetch failed:', error.message);
        }
    }

    // Initialize battery cells with waiting message (always visible, no mock data)
    function initializeBatteryCellsWaiting() {
        // Reset values to waiting state
        const cellDayMax = document.getElementById('cellDayMax');
        const cellAvg = document.getElementById('cellAvg');
        const cellMax = document.getElementById('cellMax');
        const cellMin = document.getElementById('cellMin');
        const cellDiffValue = document.getElementById('cellDiffValue');
        const cellCountBadge = document.getElementById('cellCountBadge');
        const cellUpdateTime = document.getElementById('cellUpdateTime');

        if (cellDayMax) cellDayMax.textContent = '--';
        if (cellAvg) cellAvg.textContent = '--';
        if (cellMax) cellMax.textContent = '--';
        if (cellMin) cellMin.textContent = '--';
        if (cellDiffValue) {
            cellDiffValue.textContent = '--';
            cellDiffValue.className = 'text-sm sm:text-lg font-black text-slate-500';
        }
        if (cellCountBadge) cellCountBadge.textContent = '-- cell';
        if (cellUpdateTime) cellUpdateTime.textContent = '--:--:--';

        // Reset day max tracker
        previousValues['cellDayMax_value'] = '0';

        // Show waiting message in cell grid
        const cellGrid = document.getElementById('cellGrid');
        if (cellGrid) {
            cellGrid.innerHTML = `
                <div class="cell-placeholder bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-xl p-6 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-300 dark:border-slate-600">
                    <div class="animate-pulse flex items-center gap-2">
                        <svg class="w-5 h-5 text-teal-500 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span class="text-slate-500 dark:text-slate-400 text-sm font-medium">Đang chờ dữ liệu cell volt...</span>
                    </div>
                    <p class="text-xs text-slate-400 dark:text-slate-500 text-center">Dữ liệu sẽ hiển thị khi nhận được từ hệ thống</p>
                </div>
            `;
        }

        // Auto-hide cell section content when initializing (no data yet)
        const cellSectionContent = document.getElementById('cellSectionContent');
        const toggleIcon = document.getElementById('toggleIcon');
        const toggleText = document.getElementById('toggleText');

        if (cellSectionContent && !cellSectionContent.classList.contains('hidden')) {
            cellSectionContent.classList.add('hidden');
            if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
            if (toggleText) toggleText.textContent = 'Hiện';
        }

        console.log("Battery cell section initialized - waiting for real system data");
    }

    // Request cell data reload via SignalR
    function requestCellDataReload() {
        const reloadBtn = document.getElementById('reloadCellBtn');
        if (reloadBtn) {
            // Add spinning animation
            reloadBtn.classList.add('animate-spin');
            setTimeout(() => reloadBtn.classList.remove('animate-spin'), 1000);
        }

        // Request new cell data from server
        if (connection && connection.state === "Connected" && currentDeviceId) {
            connection.invoke("RequestBatteryCellData", currentDeviceId)
                .then(() => console.log("Requested cell data reload"))
                .catch(err => console.error("Cell reload error:", err));
        }

        console.log("Cell data reload requested");
    }

    // Update cell update time display
    function updateCellUpdateTime() {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const cellUpdateTimeEl = document.getElementById('cellUpdateTime');
        if (cellUpdateTimeEl) {
            cellUpdateTimeEl.textContent = timeStr;
        }
    }

    function updateBatteryCellDisplay(data) {
        if (!data || !data.cells) return;

        const cells = data.cells;
        const validCells = cells.filter(v => v > 0);

        // If no valid cells, show "no communication" message
        if (validCells.length === 0) {
            console.log("No valid cell data - device may not support cell monitoring");
            showNoCellCommunication();
            return;
        }

        // Mark that we have received real cell data
        cellDataReceived = true;
        hasCellData = true;

        console.log("Received real cell data from system:", validCells.length, "cells");

        // Auto-expand cell section content when we have valid data
        const cellSectionContent = document.getElementById('cellSectionContent');
        const toggleIcon = document.getElementById('toggleIcon');
        const toggleText = document.getElementById('toggleText');

        if (cellSectionContent && cellSectionContent.classList.contains('hidden')) {
            cellSectionContent.classList.remove('hidden');
            if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
            if (toggleText) toggleText.textContent = 'Ẩn';
        }

        // Update cell update time
        updateCellUpdateTime();

        // Calculate statistics
        const avg = validCells.reduce((a, b) => a + b, 0) / validCells.length;
        const max = Math.max(...validCells);
        const min = Math.min(...validCells);
        const diff = max - min;

        // Update cell count badge
        const cellCountBadge = document.getElementById('cellCountBadge');
        if (cellCountBadge) {
            cellCountBadge.textContent = `${validCells.length} cell`;
        }

        // Update summary with blink effect
        updateValue('cellAvg', avg.toFixed(3) + 'V');
        updateValue('cellMax', max.toFixed(3) + 'V');
        updateValue('cellMin', min.toFixed(3) + 'V');
        updateValue('cellDiffValue', diff.toFixed(3) + 'V');

        // Update day max voltage from API data (if available)
        if (data.maximumVoltage) {
            updateValue('cellDayMax', data.maximumVoltage.toFixed(3) + 'V');
        } else {
            // Track max voltage during the session
            const currentDayMax = parseFloat(previousValues['cellDayMax_value'] || '0');
            if (max > currentDayMax) {
                previousValues['cellDayMax_value'] = max.toString();
                updateValue('cellDayMax', max.toFixed(3) + 'V');
            }
        }

        // Update diff color
        const diffEl = document.getElementById('cellDiffValue');
        if (diffEl) {
            diffEl.className = 'text-sm sm:text-lg font-black';
            if (diff > 0.05) {
                diffEl.classList.add('text-red-600', 'dark:text-red-400');
            } else if (diff > 0.02) {
                diffEl.classList.add('text-amber-600', 'dark:text-amber-400');
            } else {
                diffEl.classList.add('text-green-600', 'dark:text-green-400');
            }
        }

        // Track update time for communication status
        const currentTime = Date.now();
        lastCellUpdateTime = currentTime;

        // Find indices of max and min cells (only valid cells)
        let maxCellIndex = -1;
        let minCellIndex = -1;
        cells.forEach((voltage, index) => {
            if (voltage && voltage > 0) {
                if (voltage === max) maxCellIndex = index;
                if (voltage === min) minCellIndex = index;
            }
        });

        // Generate cell grid dynamically with blink effect and communication status
        const cellGrid = document.getElementById('cellGrid');
        if (cellGrid) {
            let gridHtml = '<div class="grid">';

            cells.forEach((voltage, index) => {
                const cellKey = `cell_${index}`;
                const prevVoltage = previousCellValues[cellKey];
                const hasChanged = prevVoltage !== undefined && prevVoltage !== voltage;
                previousCellValues[cellKey] = voltage;

                // Check communication status (voltage = 0 means no communication)
                const noCommunication = voltage === 0 || voltage === null || voltage === undefined;

                if (noCommunication) {
                    // Cell has no communication
                    gridHtml += `
                        <div class="cell-item cell-no-communication relative">
                            <span class="cell-label">Cell ${index + 1}</span>
                            <span class="cell-voltage">N/A</span>
                            <span class="text-[8px] text-red-400 block">Mất kết nối</span>
                        </div>
                    `;
                } else {
                    const deviation = Math.abs(voltage - avg);
                    let colorClass = 'cell-default';

                    if (deviation < 0.02) {
                        colorClass = 'cell-good';
                    } else if (deviation < 0.05) {
                        colorClass = 'cell-ok';
                    } else {
                        colorClass = 'cell-warning';
                    }

                    // Add blink class if value changed
                    const blinkClass = hasChanged ? 'cell-blink' : '';

                    // Check if this cell is MAX or MIN
                    const isMaxCell = index === maxCellIndex;
                    const isMinCell = index === minCellIndex;
                    const highlightClass = isMaxCell ? 'cell-max-highlight' : (isMinCell ? 'cell-min-highlight' : '');

                    // Badge for max/min
                    let badge = '';
                    if (isMaxCell) {
                        badge = '<span class="cell-badge cell-badge-max">▲ MAX</span>';
                    } else if (isMinCell) {
                        badge = '<span class="cell-badge cell-badge-min">▼ MIN</span>';
                    }

                    // Calculate voltage bar percentage based on LiFePO4 voltage scale
                    // LiFePO4 3.2V cell: Min safe = 2.5V, Nominal = 3.2V, Max = 3.65V
                    const VOLTAGE_MIN = 2.5;  // 0% - empty
                    const VOLTAGE_MAX = 3.65; // 100% - fully charged
                    const voltageRange = VOLTAGE_MAX - VOLTAGE_MIN; // 1.15V range

                    // Calculate percentage (clamped between 0-100)
                    let barPercent = ((voltage - VOLTAGE_MIN) / voltageRange) * 100;
                    barPercent = Math.max(0, Math.min(100, barPercent));

                    // Color based on LiFePO4 voltage thresholds
                    let barColorClass = 'bar-premium'; // >= 3.35V VIP
                    if (voltage < 3.0) barColorClass = 'bar-critical';
                    else if (voltage < 3.1) barColorClass = 'bar-low';
                    else if (voltage < 3.2) barColorClass = 'bar-medium';
                    else if (voltage < 3.35) barColorClass = 'bar-full';

                    gridHtml += `
                        <div class="cell-item ${colorClass} ${blinkClass} ${highlightClass}">
                            ${badge}
                            <span class="cell-label">Cell ${index + 1}</span>
                            <span class="cell-voltage">${voltage.toFixed(3)}V</span>
                            <div class="cell-voltage-bar">
                                <div class="cell-voltage-bar-fill ${barColorClass}" style="width: ${barPercent.toFixed(1)}%"></div>
                            </div>
                        </div>
                    `;
                }
            });

            gridHtml += '</div>';

            // Add communication status indicator
            const commStatus = validCells.length === cells.length ?
                '<span class="text-green-500">✓ Tất cả cell đang giao tiếp</span>' :
                `<span class="text-amber-500">⚠ ${cells.length - validCells.length} cell mất kết nối</span>`;

            gridHtml += `<div class="text-center mt-2 text-xs">${commStatus}</div>`;

            cellGrid.innerHTML = gridHtml;
        }
    }

    // Show message when device doesn't support cell monitoring
    function showNoCellCommunication() {
        const cellGrid = document.getElementById('cellGrid');
        if (cellGrid) {
            cellGrid.innerHTML = `
                <div class="cell-placeholder bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-6 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-amber-300 dark:border-amber-700">
                    <div class="flex items-center gap-2">
                        <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <span class="text-amber-600 dark:text-amber-400 text-sm font-medium">Thiết bị không hỗ trợ giám sát cell</span>
                    </div>
                    <p class="text-xs text-amber-500 dark:text-amber-500 text-center">Pin của thiết bị này không có tính năng giao tiếp cell voltage</p>
                </div>
            `;
        }

        // Reset stats
        const cellCountBadge = document.getElementById('cellCountBadge');
        if (cellCountBadge) cellCountBadge.textContent = 'N/A';

        // Auto-hide cell section content when no data (but keep header visible)
        const cellSectionContent = document.getElementById('cellSectionContent');
        const toggleIcon = document.getElementById('toggleIcon');
        const toggleText = document.getElementById('toggleText');

        if (cellSectionContent && !cellSectionContent.classList.contains('hidden')) {
            cellSectionContent.classList.add('hidden');
            if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
            if (toggleText) toggleText.textContent = 'Hiện';
        }
    }

    // ========================================
    // CHARTS
    // ========================================

    // Show loading/skeleton chart immediately while waiting for data
    // NOTE: Chart removed - this function is now a no-op
    function showLoadingChart() {
        console.log("📊 Chart disabled - showing peak stats only");
        return; // Chart removed

        // Generate time labels (same as real chart)
        const timeLabels = generateTimeLabels();

        // Create empty/skeleton data (288 points of zeros)
        const emptyData = new Array(288).fill(0);

        // Destroy existing chart if any
        if (combinedEnergyChart) combinedEnergyChart.destroy();

        // Create skeleton chart with light gray lines
        const context = ctx.getContext('2d');

        combinedEnergyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [
                    {
                        label: 'Đang tải...',
                        data: emptyData,
                        borderColor: 'rgba(148, 163, 184, 0.3)',
                        backgroundColor: 'rgba(148, 163, 184, 0.05)',
                        borderWidth: 1,
                        borderDash: [5, 5],
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 1000,
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        ticks: {
                            callback: (value) => value + ' W',
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.5)'
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 9 },
                            color: 'rgba(148, 163, 184, 0.5)',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    }
                }
            }
        });

        // Update peak stats to show loading state
        const peakStatsEl = document.getElementById('energy-peak-stats');
        if (peakStatsEl) {
            peakStatsEl.innerHTML = `
                <span class="text-slate-400 animate-pulse">⏳ Đang tải dữ liệu biểu đồ...</span>
            `;
        }
    }

    function updateCharts(data) {
        // NOTE: Chart removed - only update peak stats now
        const timeLabels = generateTimeLabels();

        const processedData = {
            pv: processChartData(data.pv.tableValueInfo),
            batCharge: processBatteryChargingData(data.bat.tableValueInfo),
            batDischarge: processBatteryDischargingData(data.bat.tableValueInfo),
            load: processChartData(data.load.tableValueInfo),
            grid: processChartData(data.grid.tableValueInfo),
            essentialLoad: processChartData(data.essentialLoad.tableValueInfo)
        };

        // Update peak stats only (chart removed)
        updateEnergyChartPeakStats(timeLabels, processedData);

        // Update date display
        const dateEl = document.getElementById('energy-chart-date');
        const dateInput = document.getElementById('dateInput');
        if (dateEl && dateInput) {
            dateEl.textContent = dateInput.value;
        }

        console.log("📊 Peak stats updated (chart disabled)");
    }

    // Combined Energy Chart - All 6 datasets in one chart - ENHANCED V2.0
    function updateCombinedEnergyChart(labels, processedData, options) {
        const ctx = document.getElementById('combinedEnergyChart');
        if (!ctx) {
            console.error("❌ Canvas 'combinedEnergyChart' not found!");
            return;
        }

        console.log("📈 Creating combined chart with", labels.length, "labels");
        console.log("📈 PV data points:", processedData.pv?.length || 0);

        // Calculate and update peak stats
        updateEnergyChartPeakStats(labels, processedData);

        // Update date display
        const dateEl = document.getElementById('energy-chart-date');
        const dateInput = document.getElementById('dateInput');
        if (dateEl && dateInput) {
            dateEl.textContent = dateInput.value;
        }

        if (combinedEnergyChart) combinedEnergyChart.destroy();

        // Create gradients for each dataset
        const context = ctx.getContext('2d');
        const chartHeight = ctx.parentElement?.clientHeight || 300;

        const createGradient = (colorStart, colorEnd) => {
            const gradient = context.createLinearGradient(0, 0, 0, chartHeight);
            gradient.addColorStop(0, colorStart);
            gradient.addColorStop(1, colorEnd);
            return gradient;
        };

        // External tooltip handler
        const externalTooltipHandler = (context) => {
            const { chart, tooltip } = context;
            const tooltipEl = document.getElementById('energy-tooltip');

            if (!tooltipEl) return;

            if (tooltip.opacity === 0) {
                tooltipEl.classList.add('hidden');
                return;
            }

            if (tooltip.dataPoints && tooltip.dataPoints.length > 0) {
                const time = tooltip.dataPoints[0].label;
                document.getElementById('energy-tooltip-time').innerHTML = `<span class="text-white font-bold">⏰ ${time}</span>`;

                const contentEl = document.getElementById('energy-tooltip-content');
                const colors = ['#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#06b6d4'];
                const icons = ['☀️', '🔋', '⚡', '🏠', '🔌', '🛡️'];
                const labelNames = ['PV', 'Sạc', 'Xả', 'Tải', 'EVN', 'Dự phòng'];

                let html = '';
                tooltip.dataPoints.forEach((point, idx) => {
                    const value = point.parsed.y;
                    // Always display in W (not kW)
                    const displayValue = `${Math.round(value)} W`;
                    html += `<div class="flex items-center justify-between gap-3">
                        <span class="flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full" style="background-color: ${colors[idx]}"></span>
                            <span>${icons[idx]} ${labelNames[idx]}</span>
                        </span>
                        <span class="font-bold" style="color: ${colors[idx]}">${displayValue}</span>
                    </div>`;
                });
                contentEl.innerHTML = html;

                // Position tooltip
                const chartArea = chart.chartArea;
                let left = tooltip.caretX;
                let top = tooltip.caretY;

                if (left + 200 > chartArea.right) {
                    left = left - 210;
                } else {
                    left = left + 15;
                }

                if (top < chartArea.top + 50) top = chartArea.top + 50;
                if (top + 200 > chartArea.bottom) top = chartArea.bottom - 200;

                tooltipEl.style.left = `${left}px`;
                tooltipEl.style.top = `${top}px`;
                tooltipEl.classList.remove('hidden');
            }
        };

        combinedEnergyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Sản Lượng PV (W)',
                        data: processedData.pv,
                        borderColor: 'rgb(245, 158, 11)',
                        backgroundColor: createGradient('rgba(245, 158, 11, 0.3)', 'rgba(245, 158, 11, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(245, 158, 11)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    },
                    {
                        label: 'Sạc Pin (W)',
                        data: processedData.batCharge,
                        borderColor: 'rgb(34, 197, 94)',
                        backgroundColor: createGradient('rgba(34, 197, 94, 0.3)', 'rgba(34, 197, 94, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(34, 197, 94)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    },
                    {
                        label: 'Xả Pin (W)',
                        data: processedData.batDischarge,
                        borderColor: 'rgb(239, 68, 68)',
                        backgroundColor: createGradient('rgba(239, 68, 68, 0.3)', 'rgba(239, 68, 68, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(239, 68, 68)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    },
                    {
                        label: 'Điện Tiêu Thụ (W)',
                        data: processedData.load,
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: createGradient('rgba(59, 130, 246, 0.3)', 'rgba(59, 130, 246, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(59, 130, 246)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    },
                    {
                        label: 'Điện Lưới EVN (W)',
                        data: processedData.grid,
                        borderColor: 'rgb(168, 85, 247)',
                        backgroundColor: createGradient('rgba(168, 85, 247, 0.3)', 'rgba(168, 85, 247, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(168, 85, 247)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    },
                    {
                        label: 'Điện Dự Phòng (W)',
                        data: processedData.essentialLoad,
                        borderColor: 'rgb(6, 182, 212)',
                        backgroundColor: createGradient('rgba(6, 182, 212, 0.3)', 'rgba(6, 182, 212, 0.02)'),
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        pointHoverRadius: 12,
                        pointHoverBackgroundColor: 'rgb(6, 182, 212)',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 3,
                        spanGaps: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 500 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(148, 163, 184, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: function (value) {
                                // Always display in W (not kW)
                                return Math.round(value) + ' W';
                            },
                            font: { size: 10 },
                            color: 'rgba(148, 163, 184, 0.8)',
                            maxTicksLimit: 6
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 9 },
                            color: 'rgba(148, 163, 184, 0.7)',
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    }
                },
                interaction: { mode: 'index', intersect: false },
                hover: { mode: 'index', intersect: false }
            },
            plugins: [{
                // Custom plugin to draw vertical line and hover circles
                id: 'hoverLine',
                afterDraw: (chart) => {
                    const activeElements = chart.getActiveElements();
                    if (activeElements.length === 0) return;

                    const ctx = chart.ctx;
                    const chartArea = chart.chartArea;
                    const x = activeElements[0].element.x;

                    // Draw vertical dashed line
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
                    ctx.lineWidth = 1;
                    ctx.moveTo(x, chartArea.top);
                    ctx.lineTo(x, chartArea.bottom);
                    ctx.stroke();
                    ctx.restore();

                    // Draw circles at each data point
                    activeElements.forEach((element, index) => {
                        const dataset = chart.data.datasets[index];
                        if (!dataset.hidden) {
                            const y = element.element.y;
                            const color = dataset.borderColor;

                            // Outer glow
                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(x, y, 10, 0, Math.PI * 2);
                            ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ', 0.2)');
                            ctx.fill();
                            ctx.restore();

                            // Main circle with white border
                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(x, y, 6, 0, Math.PI * 2);
                            ctx.fillStyle = color;
                            ctx.fill();
                            ctx.strokeStyle = '#fff';
                            ctx.lineWidth = 2;
                            ctx.stroke();
                            ctx.restore();
                        }
                    });
                }
            }]
        });

        // Mouse leave handler for tooltip
        ctx.addEventListener('mouseleave', () => {
            const tooltipEl = document.getElementById('energy-tooltip');
            if (tooltipEl) tooltipEl.classList.add('hidden');
        });
    }

    // Update energy chart peak stats - Show max power + time
    function updateEnergyChartPeakStats(labels, processedData) {
        // Helper function to find peak value and its time
        const findPeak = (data) => {
            if (!data || data.length === 0) return { peak: 0, index: -1 };
            let peak = 0;
            let peakIndex = -1;
            for (let i = 0; i < data.length; i++) {
                const val = data[i];
                if (val !== null && val !== undefined && val > peak) {
                    peak = val;
                    peakIndex = i;
                }
            }
            return { peak, index: peakIndex };
        };

        // Get time from labels array
        const getTimeFromIndex = (index) => {
            if (index < 0 || !labels || index >= labels.length) return '--:--';
            return labels[index] || '--:--';
        };

        const formatPeak = (val) => {
            if (val === 0) return '0 W';
            // Always display in W (not kW)
            return `${Math.round(val)} W`;
        };

        // Find peak for each dataset
        const pvPeak = findPeak(processedData.pv);
        const chargePeak = findPeak(processedData.batCharge);
        const dischargePeak = findPeak(processedData.batDischarge);
        const loadPeak = findPeak(processedData.load);
        const gridPeak = findPeak(processedData.grid);
        const essentialPeak = findPeak(processedData.essentialLoad);

        // Update UI elements
        const updateEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        // Update peak values and times
        updateEl('chart-pv-peak', formatPeak(pvPeak.peak));
        updateEl('chart-pv-time', getTimeFromIndex(pvPeak.index));

        updateEl('chart-charge-peak', formatPeak(chargePeak.peak));
        updateEl('chart-charge-time', getTimeFromIndex(chargePeak.index));

        updateEl('chart-discharge-peak', formatPeak(dischargePeak.peak));
        updateEl('chart-discharge-time', getTimeFromIndex(dischargePeak.index));

        updateEl('chart-load-peak', formatPeak(loadPeak.peak));
        updateEl('chart-load-time', getTimeFromIndex(loadPeak.index));

        updateEl('chart-grid-peak', formatPeak(gridPeak.peak));
        updateEl('chart-grid-time', getTimeFromIndex(gridPeak.index));

        updateEl('chart-essential-peak', formatPeak(essentialPeak.peak));
        updateEl('chart-essential-time', getTimeFromIndex(essentialPeak.index));

        console.log('📊 Peak stats updated:', {
            pv: `${formatPeak(pvPeak.peak)} @ ${getTimeFromIndex(pvPeak.index)}`,
            charge: `${formatPeak(chargePeak.peak)} @ ${getTimeFromIndex(chargePeak.index)}`,
            discharge: `${formatPeak(dischargePeak.peak)} @ ${getTimeFromIndex(dischargePeak.index)}`,
            load: `${formatPeak(loadPeak.peak)} @ ${getTimeFromIndex(loadPeak.index)}`,
            grid: `${formatPeak(gridPeak.peak)} @ ${getTimeFromIndex(gridPeak.index)}`,
            essential: `${formatPeak(essentialPeak.peak)} @ ${getTimeFromIndex(essentialPeak.index)}`
        });
    }

    // Toggle dataset visibility - exposed globally
    window.toggleDataset = function (index) {
        if (!combinedEnergyChart) return;

        const meta = combinedEnergyChart.getDatasetMeta(index);
        meta.hidden = !meta.hidden;
        combinedEnergyChart.update();

        // Update button appearance
        const buttons = document.querySelectorAll('#chartLegendToggle .legend-btn');
        if (buttons[index]) {
            buttons[index].classList.toggle('active', !meta.hidden);
        }
    };

    // ========================================
    // PRO/BASIC/3D VIEW - Helper functions
    // Main switchEnergyFlowView is defined OUTSIDE DOMContentLoaded for mobile compatibility
    // ========================================

    // latestRealtimeData is declared globally at the top of the file

    // ========================================
    // HEAT EFFECT FUNCTIONS - MUST be defined BEFORE autoSync3DHomeView
    // ========================================
    function updateLoadHeatEffect(loadPowerWatts) {
        const loadCard = document.getElementById('load-card-3d');
        if (!loadCard) return;

        loadCard.classList.remove('heat-level-0', 'heat-level-1', 'heat-level-2', 'heat-level-3', 'heat-level-4');

        let heatLevel = 0;
        if (loadPowerWatts >= 4000) {
            heatLevel = 4;
        } else if (loadPowerWatts >= 3000) {
            heatLevel = 3;
        } else if (loadPowerWatts >= 2000) {
            heatLevel = 2;
        } else if (loadPowerWatts >= 1000) {
            heatLevel = 1;
        }

        loadCard.classList.add(`heat-level-${heatLevel}`);

        // Update Load Voltage and Label colors based on heat level
        const voltageEl = document.getElementById('load-voltage-3d');
        const labelEl = document.getElementById('load-label-3d');
        const frameEl = voltageEl?.parentElement;

        // Color classes based on heat level - Light mode friendly (matching PV frame style)
        const colorClasses = {
            0: { text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-400/40 dark:border-amber-400/20', bg: 'bg-amber-100/60 dark:bg-black/20' },
            1: { text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-400/50 dark:border-amber-400/20', bg: 'bg-amber-100/70 dark:bg-black/20' },
            2: { text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-400/50 dark:border-orange-400/20', bg: 'bg-orange-100/60 dark:bg-black/20' },
            3: { text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-400/60 dark:border-orange-400/20', bg: 'bg-orange-100/70 dark:bg-black/20' },
            4: { text: 'text-red-600 dark:text-red-400', border: 'border-red-400/60 dark:border-red-400/20', bg: 'bg-red-100/70 dark:bg-black/20' }
        };

        const colors = colorClasses[heatLevel];

        // Update voltage text color
        if (voltageEl) {
            voltageEl.className = voltageEl.className
                .replace(/text-\w+-\d+/g, '')
                .replace(/dark:text-\w+-\d+/g, '')
                .trim() + ' ' + colors.text;
        }

        // Update label text color
        if (labelEl) {
            labelEl.className = labelEl.className
                .replace(/text-\w+-\d+/g, '')
                .replace(/dark:text-\w+-\d+/g, '')
                .trim() + ' ' + colors.text;
        }

        // Update frame border and background
        if (frameEl) {
            frameEl.className = frameEl.className
                .replace(/border-\w+-\d+\/\d+/g, '')
                .replace(/dark:border-\w+-\d+\/\d+/g, '')
                .replace(/bg-\w+-\d+\/\d+/g, '')
                .trim() + ' ' + colors.border + ' ' + colors.bg;
        }
    }

    function updateEssentialHeatEffect(essentialPowerWatts) {
        const essentialCard = document.getElementById('essential-card-3d');
        if (!essentialCard) return;

        essentialCard.classList.remove('essential-level-0', 'essential-level-1', 'essential-level-2', 'essential-level-3', 'essential-level-4');

        let level = 0;
        if (essentialPowerWatts >= 4000) {
            level = 4;
        } else if (essentialPowerWatts >= 3000) {
            level = 3;
        } else if (essentialPowerWatts >= 2000) {
            level = 2;
        } else if (essentialPowerWatts >= 1000) {
            level = 1;
        }

        essentialCard.classList.add(`essential-level-${level}`);
    }

    // Auto-sync data to 3D Home view elements
    // Auto-sync data to 3D Home view - With Sun/Moon animation
    function autoSync3DHomeView() {
        // Get current values from Pro view (same format as Pro)
        const pvPower = document.getElementById('pv-power')?.textContent || '--W';
        const gridPower = document.getElementById('grid-power')?.textContent || '--W';
        const batteryPercent = document.getElementById('battery-percent-icon')?.textContent || '--%';
        const batteryPower = document.getElementById('battery-power')?.textContent || '--W';
        const loadPower = document.getElementById('load-power')?.textContent || '--W';
        const essentialPower = document.getElementById('essential-power')?.textContent || '--W';

        // Get PV1/PV2 power and voltage from stored realtime data
        let pv1Power = '--W', pv2Power = '--W';
        let pv1Voltage = '--V', pv2Voltage = '--V';
        if (latestRealtimeData.pv1Power) {
            pv1Power = latestRealtimeData.pv1Power + 'W';
            pv1Voltage = (latestRealtimeData.pv1Voltage || 0) + 'V';
        }
        if (latestRealtimeData.pv2Power) {
            pv2Power = latestRealtimeData.pv2Power + 'W';
            pv2Voltage = (latestRealtimeData.pv2Voltage || 0) + 'V';
        }

        // Update 3D Home view elements with blink effect (same as Pro)
        const update3DValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                const oldValue = el.textContent;
                if (oldValue !== value) {
                    el.textContent = value;
                    el.classList.remove('value-updated');
                    void el.offsetWidth; // Force reflow
                    el.classList.add('value-updated');
                    setTimeout(() => el.classList.remove('value-updated'), 600);
                }
            }
        };

        // Update power displays
        update3DValue('pv-power-3d', pvPower);
        update3DValue('pv1-power-3d', pv1Power);
        update3DValue('pv2-power-3d', pv2Power);
        update3DValue('pv1-voltage-3d', pv1Voltage);
        update3DValue('pv2-voltage-3d', pv2Voltage);
        update3DValue('grid-power-3d', gridPower);
        update3DValue('load-power-3d', loadPower);
        update3DValue('battery-soc-3d', batteryPercent);

        // Update Load Voltage (uses Grid Voltage since load runs on AC)
        let loadVoltage = '--V';
        if (latestRealtimeData.gridVoltageValue) {
            loadVoltage = latestRealtimeData.gridVoltageValue + 'V';
        } else {
            // Fallback: get from grid-voltage element
            const gridVoltageEl = document.getElementById('grid-voltage');
            if (gridVoltageEl) {
                loadVoltage = gridVoltageEl.textContent || '--V';
            }
        }
        update3DValue('load-voltage-3d', loadVoltage);

        // Update battery SOC color based on percentage: Red 1-20%, Yellow 21-50%, Green 51-100%
        const batterySocEl = document.getElementById('battery-soc-3d');
        if (batterySocEl) {
            const socValue = parseInt(batteryPercent.replace(/[^\d]/g, '')) || 0;
            // Remove old color classes
            batterySocEl.classList.remove('text-red-500', 'text-yellow-500', 'text-emerald-400', 'text-white');
            if (socValue <= 20) {
                batterySocEl.classList.add('text-red-500'); // Red for 1-20%
            } else if (socValue <= 50) {
                batterySocEl.classList.add('text-yellow-500'); // Yellow for 21-50%
            } else {
                batterySocEl.classList.add('text-emerald-400'); // Green for 51-100%
            }
        }

        update3DValue('essential-power-3d', essentialPower);

        // Update Load Heat Effect based on power consumption
        const loadPowerVal = parseInt(loadPower.replace(/[^\d]/g, '')) || 0;
        updateLoadHeatEffect(loadPowerVal);

        // Update Essential Load Heat Effect based on power consumption
        const essentialPowerVal = parseInt(essentialPower.replace(/[^\d]/g, '')) || 0;
        updateEssentialHeatEffect(essentialPowerVal);

        // Update battery card - Heat Effect CSS handles colors based on charging/discharging
        const batteryPowerVal = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
        const batteryPercentNum = parseInt(batteryPercent.replace(/[^\d]/g, '')) || 0;
        const batteryPowerEl = document.getElementById('battery-power-3d');
        const batteryFillEl = document.getElementById('battery-fill-3d');
        const batteryPercentIconEl = document.getElementById('battery-percent-3d-icon');
        const batteryBodyEl = document.getElementById('battery-body-3d');
        const batteryCapEl = document.getElementById('battery-cap-3d');

        // Update power display with +/- sign AND status label
        // Note: Battery Heat Effect CSS handles all colors via battery-heat-card class
        const batteryStatusLabelEl = document.getElementById('battery-status-label-3d');
        if (batteryPowerEl) {
            let newValue;
            if (batteryPowerVal > 10) {
                // Charging: + màu xanh
                newValue = '+' + Math.abs(batteryPowerVal) + 'W';
                if (batteryStatusLabelEl) {
                    batteryStatusLabelEl.textContent = 'Pin đang sạc';
                }
            } else if (batteryPowerVal < -10) {
                // Discharging: - màu đỏ
                newValue = '-' + Math.abs(batteryPowerVal) + 'W';
                if (batteryStatusLabelEl) {
                    batteryStatusLabelEl.textContent = 'Pin đang xả';
                }
            } else {
                // Idle: màu emerald (đồng bộ với các card khác)
                newValue = '0W';
                if (batteryStatusLabelEl) {
                    batteryStatusLabelEl.textContent = 'Pin chờ';
                }
            }
            // Apply value with blink animation
            if (batteryPowerEl.textContent !== newValue) {
                batteryPowerEl.textContent = newValue;
                batteryPowerEl.classList.remove('value-updated');
                void batteryPowerEl.offsetWidth;
                batteryPowerEl.classList.add('value-updated');
                setTimeout(() => batteryPowerEl.classList.remove('value-updated'), 600);
            }
        }

        // Update battery icon colors based on % level - BIGGER SIZE
        // Color based on SOC: Red 1-20%, Yellow 21-50%, Green 51-100%
        let borderColorClass = 'border-emerald-400';
        let capColorClass = 'bg-emerald-400';
        if (batteryPercentNum <= 20) {
            borderColorClass = 'border-red-400';
            capColorClass = 'bg-red-400';
        } else if (batteryPercentNum <= 50) {
            borderColorClass = 'border-yellow-400';
            capColorClass = 'bg-yellow-400';
        }

        if (batteryBodyEl) {
            batteryBodyEl.className = `battery-body-3d w-16 h-7 sm:w-20 sm:h-8 rounded-[5px] border-2 ${borderColorClass} relative overflow-hidden bg-slate-900/80 transition-all duration-300`;
        }
        if (batteryCapEl) {
            batteryCapEl.className = `absolute -right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-4 sm:h-5 ${capColorClass} rounded-r-sm transition-all duration-300`;
        }

        // Update battery fill bar - width and color based on SOC level
        if (batteryFillEl) {
            batteryFillEl.style.width = Math.max(batteryPercentNum - 3, 0) + '%'; // -3% for padding
            // Color based on SOC: Red 1-20%, Yellow 21-50%, Green 51-100%
            let fillColorClass = 'bg-emerald-500'; // Default green
            if (batteryPercentNum <= 20) {
                fillColorClass = 'bg-red-500';
            } else if (batteryPercentNum <= 50) {
                fillColorClass = 'bg-yellow-500';
            }
            batteryFillEl.className = `battery-fill-3d absolute left-0.5 top-0.5 bottom-0.5 rounded-[3px] ${fillColorClass} transition-all duration-500`;
        }
        if (batteryPercentIconEl) {
            batteryPercentIconEl.textContent = batteryPercent;
        }

        // Update Battery Heat Effect based on power and status
        // Determine battery status from batteryPowerVal: positive = charging, negative = discharging
        const batteryStatus = batteryPowerVal > 10 ? 'Charging' : (batteryPowerVal < -10 ? 'Discharging' : 'Idle');
        updateBatteryHeatEffect(batteryPowerVal, batteryStatus);

        // Update Grid EVN voltage - lấy từ Pro view
        const gridVoltage = document.getElementById('grid-voltage')?.textContent || '--V';
        update3DValue('grid-voltage-3d', gridVoltage);

        // ========================================
        // Sun/Moon Animation Control
        // Show Sun when PV > 0, show Moon when PV = 0
        // ========================================
        const pvValue = parseInt(pvPower.replace(/[^\d-]/g, '')) || 0;
        const sun3D = document.getElementById('sun-3d');
        const moon3D = document.getElementById('moon-3d');

        if (sun3D && moon3D) {
            if (pvValue > 0) {
                // Daytime - show Sun
                sun3D.classList.remove('hidden');
                moon3D.classList.add('hidden');

                // Set Sun power level based on PV wattage (4 levels)
                const sunContainer = sun3D.querySelector('.sun-3d-container');
                if (sunContainer) {
                    // Reset all levels
                    sunContainer.classList.remove('sun-level-1', 'sun-level-2', 'sun-level-3', 'sun-level-4');

                    if (pvValue >= 4000) {
                        // Level 4: 4000W+ - VIP PRO, cực mạnh
                        sunContainer.classList.add('sun-level-4');
                    } else if (pvValue >= 2000) {
                        // Level 3: 2000-4000W - Rực rỡ
                        sunContainer.classList.add('sun-level-3');
                    } else if (pvValue >= 1000) {
                        // Level 2: 1000-2000W - Trung bình
                        sunContainer.classList.add('sun-level-2');
                    } else {
                        // Level 1: 0-1000W - Nhẹ nhàng
                        sunContainer.classList.add('sun-level-1');
                    }
                }
            } else {
                // Nighttime - show Moon
                sun3D.classList.add('hidden');
                moon3D.classList.remove('hidden');
            }
        }

        // PV Energy Flow Line - show/hide based on PV power
        const pvEnergyLine = document.getElementById('pv-energy-line');
        if (pvEnergyLine) {
            if (pvValue > 0) {
                pvEnergyLine.classList.remove('hidden-flow');
            } else {
                pvEnergyLine.classList.add('hidden-flow');
            }
        }

        // EVN Grid Energy Flow Line - show/hide and animate based on grid power
        // 0 < EVN <= 20W: 1 hạt | 20W < EVN <= 1000W: 2 hạt | EVN > 1000W: 3 hạt
        const gridValue = parseInt(gridPower.replace(/[^\d-]/g, '')) || 0;
        const evnEnergyLine = document.getElementById('evn-energy-line');
        if (evnEnergyLine) {
            // Reset all flow levels
            evnEnergyLine.classList.remove('hidden-flow', 'flow-level-1', 'flow-level-2', 'flow-level-3');

            if (gridValue > 0) {
                // Xác định level dựa trên công suất
                if (gridValue > 1000) {
                    // > 1000W: 3 hạt
                    evnEnergyLine.classList.add('flow-level-3');
                } else if (gridValue > 20) {
                    // 20W < EVN <= 1000W: 2 hạt
                    evnEnergyLine.classList.add('flow-level-2');
                } else {
                    // 0 < EVN <= 20W: 1 hạt
                    evnEnergyLine.classList.add('flow-level-1');
                }
            } else {
                // Ẩn hoàn toàn khi không có điện từ EVN
                evnEnergyLine.classList.add('hidden-flow');
            }
        }

        // Update battery charge/discharge animation
        const batteryVal = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
        const chargingIcon = document.getElementById('battery-charging-3d');
        const dischargingIcon = document.getElementById('battery-discharging-3d');
        const statusIcon = document.getElementById('battery-status-icon-3d');

        if (statusIcon) {
            if (batteryVal > 10) {
                // Charging (positive value = charging)
                statusIcon.classList.remove('hidden');
                chargingIcon?.classList.remove('hidden');
                dischargingIcon?.classList.add('hidden');
            } else if (batteryVal < -10) {
                // Discharging (negative value = discharging)
                statusIcon.classList.remove('hidden');
                chargingIcon?.classList.add('hidden');
                dischargingIcon?.classList.remove('hidden');
            } else {
                // Idle
                statusIcon.classList.add('hidden');
            }
        }
    }

    // Expose autoSync3DHomeView IMMEDIATELY after definition
    window.autoSync3DHomeView = autoSync3DHomeView;
    console.log('✅ window.autoSync3DHomeView exposed');

    // Auto-sync data to Basic view elements
    function autoSyncBasicView() {
        // Get current values from Pro view (original IDs)
        const pvPower = document.getElementById('pv-power')?.textContent || '--';
        const pvDesc = document.getElementById('pv-desc')?.innerHTML || '--';
        const gridPower = document.getElementById('grid-power')?.textContent || '--';
        const gridVoltage = document.getElementById('grid-voltage')?.textContent || '--';
        const batteryPercent = document.getElementById('battery-percent-icon')?.textContent || '--%';
        const batteryPower = document.getElementById('battery-power')?.textContent || '--';
        const essentialPower = document.getElementById('essential-power')?.textContent || '--';
        const loadPower = document.getElementById('load-power')?.textContent || '--';
        const deviceTemp = document.getElementById('device-temp')?.textContent || '--';
        const inverterType = document.getElementById('inverter-type')?.textContent || '--';

        // Calculate battery status from power value
        // Negative = discharging, Positive = charging
        let batteryStatus = '--';
        const powerValue = parseInt(batteryPower.replace(/[^\d-]/g, '')) || 0;
        if (powerValue < 0) {
            batteryStatus = 'Đang xả';
        } else if (powerValue > 0) {
            batteryStatus = 'Đang nạp';
        } else {
            batteryStatus = 'Chờ';
        }

        // Update Basic view elements (IDs end with -basic)
        const updateElement = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        const updateElementHTML = (id, html) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        };

        // Update all Basic view fields
        updateElement('pv-power-basic', pvPower);
        updateElementHTML('pv-desc-basic', pvDesc);
        updateElement('grid-power-basic', gridPower);
        updateElement('grid-voltage-basic', gridVoltage);
        updateElement('battery-percent-basic', batteryPercent);
        updateElement('battery-power-basic', batteryPower);
        updateElement('battery-status-basic', batteryStatus);
        updateElement('essential-power-basic', essentialPower);
        updateElement('load-power-basic', loadPower);
        updateElement('device-temp-basic', deviceTemp);
        updateElement('inverter-type-basic', inverterType);

        // Update battery fill bar
        const batteryFillBasic = document.getElementById('battery-fill-basic');
        if (batteryFillBasic) {
            const percent = parseInt(batteryPercent) || 0;
            batteryFillBasic.style.width = percent + '%';

            // Update color based on percentage
            if (percent > 60) {
                batteryFillBasic.className = 'absolute left-0 top-0 bottom-0 bg-green-500 transition-all duration-500';
            } else if (percent > 30) {
                batteryFillBasic.className = 'absolute left-0 top-0 bottom-0 bg-yellow-500 transition-all duration-500';
            } else {
                batteryFillBasic.className = 'absolute left-0 top-0 bottom-0 bg-red-500 transition-all duration-500';
            }
        }

        // Update battery power and status colors based on charging/discharging state
        const batteryPowerBasic = document.getElementById('battery-power-basic');
        const batteryStatusBasic = document.getElementById('battery-status-basic');

        if (batteryPowerBasic) {
            // Remove old color classes
            batteryPowerBasic.classList.remove(
                'text-slate-700', 'dark:text-slate-300',
                'text-emerald-500', 'dark:text-emerald-400',
                'text-orange-500', 'dark:text-orange-400',
                'text-red-500', 'dark:text-red-400'
            );

            if (powerValue > 0) {
                // Charging - Green color
                batteryPowerBasic.classList.add('text-emerald-500', 'dark:text-emerald-400');
            } else if (powerValue < 0) {
                // Discharging - Orange/Red color
                batteryPowerBasic.classList.add('text-orange-500', 'dark:text-orange-400');
            } else {
                // Idle - Default gray
                batteryPowerBasic.classList.add('text-slate-700', 'dark:text-slate-300');
            }
        }

        if (batteryStatusBasic) {
            // Remove old color classes
            batteryStatusBasic.classList.remove(
                'text-slate-500', 'dark:text-slate-400',
                'text-emerald-500', 'dark:text-emerald-400',
                'text-orange-500', 'dark:text-orange-400'
            );

            if (powerValue > 0) {
                // Charging - Green color
                batteryStatusBasic.classList.add('text-emerald-500', 'dark:text-emerald-400');
            } else if (powerValue < 0) {
                // Discharging - Orange color
                batteryStatusBasic.classList.add('text-orange-500', 'dark:text-orange-400');
            } else {
                // Idle - Default gray
                batteryStatusBasic.classList.add('text-slate-500', 'dark:text-slate-400');
            }
        }
    }

    // Expose autoSyncBasicView IMMEDIATELY after definition
    window.autoSyncBasicView = autoSyncBasicView;
    console.log('✅ window.autoSyncBasicView exposed');

    // NOTE: updateLoadHeatEffect and updateEssentialHeatEffect are now defined earlier
    // in the file (before autoSync3DHomeView) to avoid hoisting issues

    // Expose globally
    window.updateLoadHeatEffect = updateLoadHeatEffect;
    window.updateEssentialHeatEffect = updateEssentialHeatEffect;

    // ========================================
    // BATTERY HEAT EFFECT - Pin sạc/xả
    // Charging: Green levels (0-3)
    // Discharging: Red levels (0-3)
    // ========================================
    function updateBatteryHeatEffect(batteryPowerWatts, batteryStatus) {
        const batteryCard = document.getElementById('battery-card-3d');
        if (!batteryCard) return;

        // Remove all battery heat classes
        const allClasses = [
            'battery-charging-0', 'battery-charging-1', 'battery-charging-2', 'battery-charging-3',
            'battery-discharging-0', 'battery-discharging-1', 'battery-discharging-2', 'battery-discharging-3',
            'battery-idle'
        ];
        allClasses.forEach(cls => batteryCard.classList.remove(cls));

        // Use absolute value for power comparison
        const absPower = Math.abs(batteryPowerWatts);

        // Determine level (0-3) based on power
        let level = 0;
        if (absPower >= 3000) {
            level = 3;  // Intense: > 3000W
        } else if (absPower >= 2000) {
            level = 2;  // Bright: 2000-3000W
        } else if (absPower >= 1000) {
            level = 1;  // Medium: 1000-2000W
        } else {
            level = 0;  // Light: < 1000W
        }

        // Determine mode based on batteryStatus or power value
        // batteryStatus: 'Charging', 'Discharging', 'Idle', etc.
        // Or use power value: positive = discharging, negative = charging
        let mode = 'idle';
        if (batteryStatus) {
            const status = batteryStatus.toLowerCase();
            if (status.includes('charg') && !status.includes('discharg')) {
                mode = 'charging';
            } else if (status.includes('discharg')) {
                mode = 'discharging';
            }
        } else if (batteryPowerWatts !== 0) {
            // Fallback: negative = charging, positive = discharging
            mode = batteryPowerWatts < 0 ? 'charging' : 'discharging';
        }

        // Apply appropriate class
        if (mode === 'idle' || absPower < 10) {
            batteryCard.classList.add('battery-idle');
            console.log(`🔋 Battery Idle: ${batteryPowerWatts}W`);
        } else {
            batteryCard.classList.add(`battery-${mode}-${level}`);
            const emoji = mode === 'charging' ? '🔌' : '⚡';
            const color = mode === 'charging' ? 'GREEN' : 'RED';
            console.log(`${emoji} Battery ${mode}: ${absPower}W → Level ${level} (${color})`);
        }
    }

    // Expose globally
    window.updateBatteryHeatEffect = updateBatteryHeatEffect;

    // Load saved view preference on page load - Default to Pro
    const savedView = localStorage.getItem('energyFlowView') || 'pro';
    setTimeout(() => {
        window.switchEnergyFlowView(savedView);
    }, 100);

    // Add click event listeners to ensure buttons work (fix for cached pages)
    setTimeout(() => {
        const proBtn = document.getElementById('proViewBtn');
        const basicBtn = document.getElementById('basicViewBtn');
        const home3DBtn = document.getElementById('home3DViewBtn');

        if (proBtn) {
            proBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.switchEnergyFlowView('pro');
            });
        }
        if (basicBtn) {
            basicBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.switchEnergyFlowView('basic');
            });
        }
        if (home3DBtn) {
            home3DBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.switchEnergyFlowView('3dhome');
            });
        }
        console.log('Energy flow view buttons initialized');
    }, 200);

    // Legacy function - kept for backward compatibility but not used
    function createChart(chartObj, canvasId, label, labels, data, borderColor, backgroundColor, options) {
        return null; // Deprecated - using combined chart now
    }

    function updateBatChart(labels, chargeData, dischargeData, options) {
        // Deprecated - data now shown in combined chart
        // This function is kept for backward compatibility but does nothing
    }

    function getCommonChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                point: { radius: 0, hoverRadius: 4 },
                line: { borderWidth: 2, tension: 0.2 }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(50, 50, 50, 0.9)'
                },
                legend: {
                    position: 'top',
                    labels: { boxWidth: 12, padding: 10, font: { size: 11 } }
                }
            },
            scales: {
                x: {
                    ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 30 },
                    grid: { display: true, color: 'rgba(200, 200, 200, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        callback: function (value) {
                            if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
                            return value;
                        }
                    },
                    grid: { display: true, color: 'rgba(200, 200, 200, 0.1)' },
                    title: { display: true, text: 'Watt', font: { size: 11 } }
                }
            }
        };
    }

    // ========================================
    // DATA PROCESSING HELPERS
    // ========================================

    function generateTimeLabels() {
        const labels = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 5) {
                labels.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
            }
        }
        return labels;
    }

    function processChartData(data) {
        return data ? [...data] : [];
    }

    function processBatteryChargingData(data) {
        if (!data) return [];
        // Battery convention: POSITIVE = charging (power flowing INTO battery)
        // Preserve null values for future time slots
        return data.map(value => {
            if (value === null) return null;  // Keep null for no-data slots
            return value > 0 ? value : 0;
        });
    }

    function processBatteryDischargingData(data) {
        if (!data) return [];
        // Battery convention: NEGATIVE = discharging (power flowing OUT of battery)
        // We show as positive value in chart
        // Preserve null values for future time slots
        return data.map(value => {
            if (value === null) return null;  // Keep null for no-data slots
            return value < 0 ? Math.abs(value) : 0;
        });
    }

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================

    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function changeDate(offset) {
        const dateInput = document.getElementById('dateInput');
        if (!dateInput) return;

        let currentDate = new Date(dateInput.value);
        currentDate.setDate(currentDate.getDate() + offset);
        dateInput.value = formatDate(currentDate);

        // Update compact date display
        const compactDateDisplay = document.getElementById('compactDateDisplay');
        if (compactDateDisplay) {
            const day = String(currentDate.getDate()).padStart(2, '0');
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const year = currentDate.getFullYear();
            const dateStr = `${day}/${month}/${year}`;
            compactDateDisplay.textContent = dateStr;
            showDateChangeNotification(dateStr);
        }

        // Skip device notification when just changing dates
        window.skipDeviceNotification = true;
        fetchData();
    }

    function scrollToElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth' });
        }
    }

    function showElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.classList.remove('hidden');
        }
    }

    // Show rate limit warning to user
    function showRateLimitWarning() {
        // Check if warning already shown recently
        const lastWarning = parseInt(localStorage.getItem('solar_rate_limit_warning') || '0');
        if (Date.now() - lastWarning < 60000) return; // Only show once per minute

        localStorage.setItem('solar_rate_limit_warning', String(Date.now()));

        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-4 right-4 bg-yellow-500 text-white px-6 py-4 rounded-lg shadow-lg z-50 max-w-sm';
        toast.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="text-2xl">⚠️</span>
                <div>
                    <p class="font-bold">API Rate Limited</p>
                    <p class="text-sm mt-1">Quá nhiều requests. Dữ liệu sẽ được tải từ cache. Vui lòng đợi 5 phút.</p>
                </div>
                <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">&times;</button>
            </div>
        `;
        document.body.appendChild(toast);

        // Auto remove after 10 seconds
        setTimeout(() => toast.remove(), 10000);

        console.warn('⚠️ Rate limit warning shown to user');
    }

    function updateValue(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            const oldValue = previousValues[elementId];
            const newValue = String(value);

            // Only blink if value actually changed
            if (oldValue !== newValue) {
                element.textContent = value;
                element.classList.remove('value-updated');
                // Force reflow to restart animation
                void element.offsetWidth;
                element.classList.add('value-updated');
                previousValues[elementId] = newValue;

                // Remove class after animation completes
                setTimeout(() => element.classList.remove('value-updated'), 600);
            }
        }
    }

    // Update value with innerHTML and blink effect
    function updateValueHTML(elementId, html) {
        const element = document.getElementById(elementId);
        if (element) {
            const oldHTML = previousValues[elementId + '_html'];
            const newHTML = String(html);

            // Only blink if value actually changed
            if (oldHTML !== newHTML) {
                element.innerHTML = html;
                element.classList.remove('value-updated');
                void element.offsetWidth;
                element.classList.add('value-updated');
                previousValues[elementId + '_html'] = newHTML;

                setTimeout(() => element.classList.remove('value-updated'), 600);
            }
        }
    }

    function updateFlowStatus(flowId, isActive) {
        const flow = document.getElementById(flowId);
        if (flow) {
            if (isActive) {
                flow.classList.remove('inactive');
                flow.classList.add('active');
            } else {
                flow.classList.add('inactive');
                flow.classList.remove('active');
            }
        }
    }

    // Energy Flow Animation - Control particles based on power levels
    // Logic: Higher power = More particles for visual effect
    // Supports reduced animation mode (1 particle only)
    function updateEnergyFlowAnimation(data) {
        // Helper to show/hide dots by count (supports reduced mode)
        const setDotsByPower = (baseName, power, thresholds = [1000, 2000, 3000]) => {
            const dots = [
                document.getElementById(baseName),
                document.getElementById(baseName + '-2'),
                document.getElementById(baseName + '-3')
            ];

            let count = 0;
            if (power > 0) {
                if (reducedAnimationMode) {
                    count = 1; // Reduced mode: always 1 particle
                } else {
                    if (power >= thresholds[2]) count = 3;      // >= 3000W: 3 particles
                    else if (power >= thresholds[1]) count = 2; // >= 2000W: 2 particles
                    else count = 1;                              // > 0W: 1 particle
                }
            }

            dots.forEach((dot, i) => {
                if (dot) dot.style.display = (i < count) ? 'block' : 'none';
            });
        };

        // Helper for PV/EVN with high power mode (5 particles at >=3000W)
        const setDotsByPowerHighMode = (baseName, power) => {
            const dots = [
                document.getElementById(baseName),
                document.getElementById(baseName + '-2'),
                document.getElementById(baseName + '-3'),
                document.getElementById(baseName + '-4'),
                document.getElementById(baseName + '-5')
            ];

            let count = 0;
            if (power > 0) {
                if (reducedAnimationMode) {
                    count = 1; // Reduced mode: always 1 particle
                } else {
                    if (power >= 3000) count = 5;  // >= 3000W: 5 particles
                    else count = 3;                 // < 3000W: 3 particles
                }
            }

            dots.forEach((dot, i) => {
                if (dot) dot.style.display = (i < count) ? 'block' : 'none';
            });
        };

        // Helper to set battery dot state
        const setBatteryState = (state) => {
            const dots = [
                document.getElementById('battery-flow-dot'),
                document.getElementById('battery-flow-dot-2'),
                document.getElementById('battery-flow-dot-3')
            ];
            dots.forEach(dot => {
                if (dot) {
                    dot.classList.remove('charging', 'discharging');
                    if (state) dot.classList.add(state);
                }
            });
        };

        // === PV Flow: 0W=0, <3000W=3 particles, >=3000W=5 particles (or 1 in reduced mode) ===
        setDotsByPowerHighMode('pv-flow-dot', data.pvTotalPower);

        // === EVN Grid Flow: Same logic as PV ===
        setDotsByPowerHighMode('evn-flow-dot', data.gridValue > 20 ? data.gridValue : 0);

        // === Battery Flow: 1000W=1, 2000W=2, 3000W=3 particles (or 1 in reduced mode) ===
        const batteryPower = Math.abs(data.batteryValue);
        if (data.batteryStatus === "Charging" && data.batteryValue > 0) {
            setDotsByPower('battery-flow-dot', batteryPower);
            setBatteryState('charging');
        } else if (data.batteryStatus === "Discharging" && batteryPower > 0) {
            setDotsByPower('battery-flow-dot', batteryPower);
            setBatteryState('discharging');
        } else {
            setDotsByPower('battery-flow-dot', 0);
            setBatteryState(null);
        }

        // === Essential Load (Tải cổng load): 1000W=1, 2000W=2, 3000W=3 particles (or 1 in reduced mode) ===
        setDotsByPower('essential-flow-dot', data.essentialValue);

        // === Grid Load (Tải hòa lưới): 1000W=1, 2000W=2, 3000W=3 particles (or 1 in reduced mode) ===
        setDotsByPower('load-flow-dot', data.loadValue);
    }

    // Toggle animation mode function - exposed globally
    window.toggleAnimationMode = function () {
        reducedAnimationMode = !reducedAnimationMode;

        // Save preference to localStorage
        localStorage.setItem('energyFlowAnimationMode', reducedAnimationMode ? 'reduced' : 'normal');

        // Update button appearance
        updateAnimationButtonUI();

        console.log('Animation mode:', reducedAnimationMode ? 'REDUCED (1 particle)' : 'NORMAL (multiple particles)');
    };

    // Update animation button UI based on current mode
    function updateAnimationButtonUI() {
        const btn = document.getElementById('toggleAnimationBtn');
        const btnText = document.getElementById('animationBtnText');
        const icon = document.getElementById('animationIcon');

        if (!btn || !btnText || !icon) return;

        if (reducedAnimationMode) {
            // Reduced mode active - button shows "Tăng hiệu ứng"
            btn.classList.remove('bg-slate-100', 'hover:bg-slate-200', 'dark:bg-slate-700', 'dark:hover:bg-slate-600',
                'text-slate-600', 'dark:text-slate-300', 'border-slate-300', 'dark:border-slate-600');
            btn.classList.add('bg-amber-100', 'hover:bg-amber-200', 'dark:bg-amber-900/50', 'dark:hover:bg-amber-800/50',
                'text-amber-700', 'dark:text-amber-300', 'border-amber-400', 'dark:border-amber-600');
            btnText.textContent = 'Tăng hiệu ứng';
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>';
        } else {
            // Normal mode - button shows "Giảm hiệu ứng"
            btn.classList.remove('bg-amber-100', 'hover:bg-amber-200', 'dark:bg-amber-900/50', 'dark:hover:bg-amber-800/50',
                'text-amber-700', 'dark:text-amber-300', 'border-amber-400', 'dark:border-amber-600');
            btn.classList.add('bg-slate-100', 'hover:bg-slate-200', 'dark:bg-slate-700', 'dark:hover:bg-slate-600',
                'text-slate-600', 'dark:text-slate-300', 'border-slate-300', 'dark:border-slate-600');
            btnText.textContent = 'Giảm hiệu ứng';
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>';
        }
    }

    // Initialize animation button UI on page load (after function is defined)
    updateAnimationButtonUI();

    function showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.toggle('hidden', !show);
        }
    }

    function showError(message) {
        const errorDiv = document.getElementById('errorMessage');
        const errorText = document.getElementById('errorText');
        if (errorDiv && errorText) {
            // Support multi-line messages by converting \n to <br>
            errorText.innerHTML = message.replace(/\n/g, '<br>');
            errorDiv.classList.remove('hidden');

            // Scroll to error message
            errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function hideError() {
        const errorDiv = document.getElementById('errorMessage');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    // ========================================
    // AUTO REFRESH - DISABLED
    // ========================================
    // NOTE: Auto-refresh is disabled. Chart data loads only once on page load.
    // To reload data, user must press F5 or click "Xem Dữ Liệu" button.
    // 
    // Previously: setInterval(() => fetchData(), 5 * 60 * 1000);
    // Disabled to prevent continuous chart reloading

    // ========================================
    // SOLAR RADIATION FORECAST (Open-Meteo API)
    // ========================================

    // 63 tỉnh thành Việt Nam với tọa độ
    const VIETNAM_CITIES = {
        // === Miền Nam ===
        'TP. Hồ Chí Minh': { lat: 10.8231, lon: 106.6297, region: 'Miền Nam' },
        'Bà Rịa - Vũng Tàu': { lat: 10.4114, lon: 107.1362, region: 'Miền Nam' },
        'Bình Dương': { lat: 11.0753, lon: 106.6189, region: 'Miền Nam' },
        'Bình Phước': { lat: 11.7512, lon: 106.7235, region: 'Miền Nam' },
        'Đồng Nai': { lat: 10.9574, lon: 106.8426, region: 'Miền Nam' },
        'Tây Ninh': { lat: 11.3555, lon: 106.1099, region: 'Miền Nam' },
        'Long An': { lat: 10.6956, lon: 106.2431, region: 'Miền Nam' },
        'Tiền Giang': { lat: 10.4493, lon: 106.3420, region: 'Miền Nam' },
        'Bến Tre': { lat: 10.2433, lon: 106.3752, region: 'Miền Nam' },
        'Vĩnh Long': { lat: 10.2537, lon: 105.9722, region: 'Miền Nam' },
        'Trà Vinh': { lat: 9.8127, lon: 106.2993, region: 'Miền Nam' },
        'Đồng Tháp': { lat: 10.4937, lon: 105.6882, region: 'Miền Nam' },
        'An Giang': { lat: 10.5216, lon: 105.1259, region: 'Miền Nam' },
        'Kiên Giang': { lat: 10.0125, lon: 105.0809, region: 'Miền Nam' },
        'Cần Thơ': { lat: 10.0452, lon: 105.7469, region: 'Miền Nam' },
        'Hậu Giang': { lat: 9.7579, lon: 105.6413, region: 'Miền Nam' },
        'Sóc Trăng': { lat: 9.6037, lon: 105.9800, region: 'Miền Nam' },
        'Bạc Liêu': { lat: 9.2940, lon: 105.7216, region: 'Miền Nam' },
        'Cà Mau': { lat: 9.1769, lon: 105.1524, region: 'Miền Nam' },
        // === Miền Trung ===
        'Đà Nẵng': { lat: 16.0544, lon: 108.2022, region: 'Miền Trung' },
        'Thừa Thiên Huế': { lat: 16.4637, lon: 107.5909, region: 'Miền Trung' },
        'Quảng Nam': { lat: 15.5394, lon: 108.0191, region: 'Miền Trung' },
        'Quảng Ngãi': { lat: 15.1214, lon: 108.8044, region: 'Miền Trung' },
        'Bình Định': { lat: 13.7765, lon: 109.2237, region: 'Miền Trung' },
        'Phú Yên': { lat: 13.0882, lon: 109.0929, region: 'Miền Trung' },
        'Khánh Hòa': { lat: 12.2388, lon: 109.1967, region: 'Miền Trung' },
        'Ninh Thuận': { lat: 11.5752, lon: 108.9890, region: 'Miền Trung' },
        'Bình Thuận': { lat: 10.9289, lon: 108.1021, region: 'Miền Trung' },
        'Quảng Bình': { lat: 17.4656, lon: 106.6222, region: 'Miền Trung' },
        'Quảng Trị': { lat: 16.7504, lon: 107.1856, region: 'Miền Trung' },
        'Hà Tĩnh': { lat: 18.3559, lon: 105.8877, region: 'Miền Trung' },
        'Nghệ An': { lat: 18.6737, lon: 105.6922, region: 'Miền Trung' },
        'Thanh Hóa': { lat: 19.8067, lon: 105.7852, region: 'Miền Trung' },
        // === Tây Nguyên ===
        'Kon Tum': { lat: 14.3545, lon: 108.0005, region: 'Tây Nguyên' },
        'Gia Lai': { lat: 13.9833, lon: 108.0000, region: 'Tây Nguyên' },
        'Đắk Lắk': { lat: 12.6800, lon: 108.0378, region: 'Tây Nguyên' },
        'Đắk Nông': { lat: 12.0033, lon: 107.6876, region: 'Tây Nguyên' },
        'Lâm Đồng': { lat: 11.9404, lon: 108.4583, region: 'Tây Nguyên' },
        // === Miền Bắc ===
        'Hà Nội': { lat: 21.0285, lon: 105.8542, region: 'Miền Bắc' },
        'Hải Phòng': { lat: 20.8449, lon: 106.6881, region: 'Miền Bắc' },
        'Quảng Ninh': { lat: 21.0064, lon: 107.2925, region: 'Miền Bắc' },
        'Bắc Giang': { lat: 21.2819, lon: 106.1975, region: 'Miền Bắc' },
        'Bắc Ninh': { lat: 21.1861, lon: 106.0763, region: 'Miền Bắc' },
        'Hải Dương': { lat: 20.9373, lon: 106.3146, region: 'Miền Bắc' },
        'Hưng Yên': { lat: 20.6464, lon: 106.0511, region: 'Miền Bắc' },
        'Thái Bình': { lat: 20.4463, lon: 106.3365, region: 'Miền Bắc' },
        'Nam Định': { lat: 20.4388, lon: 106.1621, region: 'Miền Bắc' },
        'Ninh Bình': { lat: 20.2506, lon: 105.9745, region: 'Miền Bắc' },
        'Hà Nam': { lat: 20.5835, lon: 105.9230, region: 'Miền Bắc' },
        'Vĩnh Phúc': { lat: 21.3609, lon: 105.5474, region: 'Miền Bắc' },
        'Phú Thọ': { lat: 21.3227, lon: 105.2280, region: 'Miền Bắc' },
        'Thái Nguyên': { lat: 21.5942, lon: 105.8482, region: 'Miền Bắc' },
        'Bắc Kạn': { lat: 22.1470, lon: 105.8348, region: 'Miền Bắc' },
        'Cao Bằng': { lat: 22.6663, lon: 106.2522, region: 'Miền Bắc' },
        'Lạng Sơn': { lat: 21.8537, lon: 106.7615, region: 'Miền Bắc' },
        'Tuyên Quang': { lat: 21.8233, lon: 105.2180, region: 'Miền Bắc' },
        'Hà Giang': { lat: 22.8333, lon: 104.9833, region: 'Miền Bắc' },
        'Yên Bái': { lat: 21.7168, lon: 104.8986, region: 'Miền Bắc' },
        'Lào Cai': { lat: 22.4856, lon: 103.9707, region: 'Miền Bắc' },
        'Lai Châu': { lat: 22.3864, lon: 103.4703, region: 'Miền Bắc' },
        'Điện Biên': { lat: 21.3860, lon: 103.0230, region: 'Miền Bắc' },
        'Sơn La': { lat: 21.3256, lon: 103.9188, region: 'Miền Bắc' },
        'Hòa Bình': { lat: 20.8171, lon: 105.3376, region: 'Miền Bắc' },
    };

    let currentSolarCity = 'TP. Hồ Chí Minh';
    let solarForecastData = null;

    // Get solar radiation level info
    function getSolarLevel(radiation) {
        if (radiation <= 0) return { level: 'none', text: 'Đêm', color: '#64748b', bg: 'solar-level-none' };
        if (radiation < 200) return { level: 'low', text: 'Yếu', color: '#84cc16', bg: 'solar-level-low' };
        if (radiation < 500) return { level: 'medium', text: 'Trung bình', color: '#eab308', bg: 'solar-level-medium' };
        if (radiation < 800) return { level: 'high', text: 'Mạnh', color: '#f97316', bg: 'solar-level-high' };
        return { level: 'extreme', text: 'Rất mạnh', color: '#ef4444', bg: 'solar-level-extreme' };
    }

    // Get weather icon based on radiation and cloud cover
    function getSolarIcon(radiation, cloudCover) {
        if (radiation <= 0) return '🌙';
        if (cloudCover > 80) return '☁️';
        if (cloudCover > 50) return '⛅';
        if (cloudCover > 20) return '🌤️';
        return '☀️';
    }

    // Get UV level info
    function getUVLevel(uv) {
        if (uv <= 0) return { text: '--', color: '#64748b', bg: 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300' };
        if (uv < 3) return { text: 'Thấp', color: '#22c55e', bg: 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300' };
        if (uv < 6) return { text: 'TB', color: '#eab308', bg: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300' };
        if (uv < 8) return { text: 'Cao', color: '#f97316', bg: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300' };
        if (uv < 11) return { text: 'Rất cao', color: '#ef4444', bg: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300' };
        return { text: 'Cực độ', color: '#a855f7', bg: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300' };
    }

    // Get rain probability color
    function getRainColor(prob) {
        if (prob <= 20) return 'text-green-600 dark:text-green-400';
        if (prob <= 50) return 'text-yellow-600 dark:text-yellow-400';
        if (prob <= 70) return 'text-orange-600 dark:text-orange-400';
        return 'text-blue-600 dark:text-blue-400';
    }

    // Fetch solar radiation forecast from Open-Meteo
    async function fetchSolarForecast(cityKey = 'TP. Hồ Chí Minh') {
        const city = VIETNAM_CITIES[cityKey] || VIETNAM_CITIES['TP. Hồ Chí Minh'];
        console.log('☀️ Fetching solar forecast for:', cityKey);
        currentSolarCity = cityKey;

        try {
            // Enhanced API with UV index, sunshine duration, precipitation probability
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=shortwave_radiation,temperature_2m,cloudcover,uv_index,precipitation_probability&daily=sunshine_duration&timezone=Asia/Ho_Chi_Minh&forecast_days=2`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch solar data');

            const data = await response.json();
            solarForecastData = data;

            renderSolarForecast(data, cityKey);

            // Update location display
            const locationEl = document.getElementById('solar-location');
            if (locationEl) locationEl.textContent = `📍 ${cityKey}`;

            // Update time
            const timeEl = document.getElementById('solar-update-time');
            if (timeEl) {
                const now = new Date();
                timeEl.textContent = `Cập nhật: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            }

        } catch (error) {
            console.error('Error fetching solar forecast:', error);
        }
    }

    // Render solar forecast UI
    function renderSolarForecast(data, cityKey) {
        if (!data || !data.hourly) return;

        const times = data.hourly.time;
        const radiation = data.hourly.shortwave_radiation;
        const temps = data.hourly.temperature_2m;
        const clouds = data.hourly.cloudcover;
        const uvIndex = data.hourly.uv_index || [];
        const precipProb = data.hourly.precipitation_probability || [];

        // Daily data
        const dailySunshine = data.daily?.sunshine_duration || [];

        // Find current hour index
        const now = new Date();
        const currentHour = now.getHours();
        const todayStr = now.toISOString().split('T')[0];

        let currentIndex = times.findIndex(t => {
            const d = new Date(t);
            return d.toISOString().split('T')[0] === todayStr && d.getHours() === currentHour;
        });

        if (currentIndex === -1) currentIndex = 0;

        // Update current solar info
        const currentRadiation = radiation[currentIndex] || 0;
        const currentTemp = temps[currentIndex] || 0;
        const currentCloud = clouds[currentIndex] || 0;
        const currentUV = uvIndex[currentIndex] || 0;
        const currentRainProb = precipProb[currentIndex] || 0;
        const currentLevel = getSolarLevel(currentRadiation);
        const uvLevel = getUVLevel(currentUV);

        // Sunshine duration in hours (API returns seconds) - This is FORECAST for today
        const sunshineHours = dailySunshine[0] ? (dailySunshine[0] / 3600).toFixed(1) : '--';

        const currentValueEl = document.getElementById('solar-current-value');
        const currentIconEl = document.getElementById('solar-current-icon');
        const levelDotEl = document.getElementById('solar-level-dot');
        const levelTextEl = document.getElementById('solar-level-text');
        const tempEl = document.getElementById('solar-temp');
        const cloudEl = document.getElementById('solar-cloud');

        // New elements
        const uvValueEl = document.getElementById('solar-uv-value');
        const uvBadgeEl = document.getElementById('solar-uv-badge');
        const sunshineDurationEl = document.getElementById('solar-sunshine-duration');
        const rainProbEl = document.getElementById('solar-rain-prob');

        if (currentValueEl) currentValueEl.textContent = `${Math.round(currentRadiation)} W/m²`;
        if (currentIconEl) currentIconEl.textContent = getSolarIcon(currentRadiation, currentCloud);
        if (levelDotEl) levelDotEl.style.backgroundColor = currentLevel.color;
        if (levelTextEl) {
            levelTextEl.textContent = currentLevel.text;
            levelTextEl.style.color = currentLevel.color;
        }
        if (tempEl) tempEl.textContent = `${Math.round(currentTemp)}°C`;
        if (cloudEl) cloudEl.textContent = `${Math.round(currentCloud)}%`;

        // Update new elements
        if (uvValueEl) uvValueEl.textContent = currentUV > 0 ? currentUV.toFixed(1) : '--';
        if (uvBadgeEl) {
            uvBadgeEl.textContent = uvLevel.text;
            uvBadgeEl.className = `text-[9px] px-1 py-0.5 rounded ${uvLevel.bg}`;
        }
        if (sunshineDurationEl) sunshineDurationEl.textContent = `${sunshineHours}h`;
        if (rainProbEl) {
            rainProbEl.textContent = `${Math.round(currentRainProb)}%`;
            rainProbEl.className = `text-xs font-semibold ${getRainColor(currentRainProb)}`;
        }

        // Render hourly scroll (next 24 hours)
        const scrollContainer = document.getElementById('solarHourlyScroll');
        if (!scrollContainer) return;

        // Clear placeholder
        scrollContainer.innerHTML = '';

        // Show hours from current to +24h
        const hoursToShow = 24;
        for (let i = currentIndex; i < Math.min(currentIndex + hoursToShow, times.length); i++) {
            const time = new Date(times[i]);
            const rad = radiation[i] || 0;
            const cloud = clouds[i] || 0;
            const uv = uvIndex[i] || 0;
            const rain = precipProb[i] || 0;
            const level = getSolarLevel(rad);
            const icon = getSolarIcon(rad, cloud);

            const hourStr = time.getHours().toString().padStart(2, '0') + ':00';
            const isCurrentHour = i === currentIndex;
            const isNextDay = time.getDate() !== now.getDate();

            // Build tooltip with all info
            const tooltip = `${hourStr}\nBức xạ: ${Math.round(rad)} W/m²\nUV: ${uv.toFixed(1)}\nMây: ${Math.round(cloud)}%\nMưa: ${Math.round(rain)}%`;

            const item = document.createElement('div');
            item.className = `solar-hour-item ${level.bg} ${isCurrentHour ? 'current' : ''}`;
            item.title = tooltip;
            item.innerHTML = `
                <div class="solar-time ${level.level === 'none' ? 'text-slate-400' : 'text-white/90'}">${hourStr}</div>
                <div class="solar-icon">${icon}</div>
                <div class="solar-value ${level.level === 'none' ? 'text-slate-500' : 'text-white'}">${Math.round(rad)}</div>
                ${rain > 30 ? `<div class="solar-rain text-white/90">🌧️${Math.round(rain)}%</div>` : ''}
            `;

            scrollContainer.appendChild(item);
        }

        // Auto-scroll to show current hour
        if (scrollContainer.firstChild) {
            scrollContainer.scrollLeft = 0;
        }
    }

    // Initialize solar forecast - load saved city or default to TP. Hồ Chí Minh
    const savedSolarCity = localStorage.getItem('solarForecastCity') || 'TP. Hồ Chí Minh';
    console.log('☀️ Solar forecast init - city:', savedSolarCity);

    // Set dropdown to saved value
    const citySelect = document.getElementById('solar-city-select');
    if (citySelect) {
        citySelect.value = savedSolarCity;
    }

    // Fetch initial data
    fetchSolarForecast(savedSolarCity);

    // Refresh solar forecast every 30 minutes
    setInterval(() => fetchSolarForecast(currentSolarCity), 30 * 60 * 1000);

    // Expose function globally for city change
    window.changeSolarCity = function (cityKey) {
        if (VIETNAM_CITIES[cityKey]) {
            // Save to localStorage
            localStorage.setItem('solarForecastCity', cityKey);
            fetchSolarForecast(cityKey);
        }
    };

    // Listen for theme changes
    const observer = new MutationObserver(() => {
        configureChartDefaults();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});
