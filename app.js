/**
 * DEX-AUDIO v2.1 Logic - Improved PWA Interaction
 */

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const CHAR_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const CHAR_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

let bleDevice, rxCharacteristic, txCharacteristic;
let lastVolStep = 0;
let mobilePlayer = new Audio();

// --- LINK & RESTART HANDLING ---

async function connectToBLE() {
    if (!navigator.bluetooth) { alert("Use Chrome (Android) or Bluefy (iOS)"); return; }
    try {
        const statusEl = document.getElementById('status');
        statusEl.innerText = "LINKING...";
        
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'DexRadio_Remote' }],
            optionalServices: [SERVICE_UUID]
        });

        // FIX: Detect if Radio reboots or goes offline
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        rxCharacteristic = await service.getCharacteristic(CHAR_RX_UUID);
        txCharacteristic = await service.getCharacteristic(CHAR_TX_UUID);

        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);
        
        statusEl.innerText = "SYSTEM ONLINE";
        statusEl.style.color = "var(--amber)";
        document.getElementById('connectBtn').style.display = 'none';
        refreshList();
    } catch (e) { 
        console.log("Connect failed", e); 
        document.getElementById('status').innerText = "OFFLINE"; 
    }
}

function onDisconnected() {
    // Triggers instantly when ESP32 resets (e.g. after BUFFER change)
    const statusEl = document.getElementById('status');
    statusEl.innerText = "LINK LOST - RECONNECTING...";
    statusEl.style.color = "var(--needle-red)";
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('nowPlaying').innerText = "OFFLINE";
    
    // Clear the active Tuning Dial markers
    Array.from(document.getElementsByClassName('dial-item')).forEach(el => el.classList.remove('active'));
    
    // Optional: Attempt auto-reconnect or wait for user to pull-to-refresh
}

async function sendCommand(cmd) {
    if (!rxCharacteristic) return;
    try { 
        await rxCharacteristic.writeValue(new TextEncoder().encode(cmd + "\n")); 
    } catch (e) { 
        console.log("Command failed - Device likely offline"); 
    }
}

function handleNotifications(event) {
    let msg = new TextDecoder().decode(event.target.value).trim();
    if (msg.startsWith("NOW:")) {
        let name = msg.substring(4);
        document.getElementById('nowPlaying').innerText = name.toUpperCase();
        syncTuningDial(name);
    } else if (msg.includes('|')) {
        let parts = msg.split('|');
        if (parts.length >= 3) addStationToListUI(parts[0], parts[1], parts[2]);
    }
}

// --- ROTATIONAL VOLUME KNOB ---
const volKnob = document.getElementById('volumeKnob');
if (volKnob) {
    volKnob.addEventListener('touchmove', e => {
        e.preventDefault();
        const rect = volKnob.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.touches[0].clientY - centerY, e.touches[0].clientX - centerX) * 180 / Math.PI;
        const normalizedAngle = (angle + 360) % 360;
        
        volKnob.style.transform = `rotate(${normalizedAngle}deg)`;
        let step = Math.floor(normalizedAngle / 30);
        if (step !== lastVolStep) {
            sendCommand(step > lastVolStep ? 'VOL_UP' : 'VOL_DN');
            lastVolStep = step;
        }
    }, {passive: false});
}

// --- UI & STATION LOGIC ---
function refreshList() {
    document.getElementById('stationList').innerHTML = "";
    document.getElementById('stationScroll').innerHTML = "";
    sendCommand('LIST');
}

function addStationToListUI(idx, name, url) {
    const list = document.getElementById('stationList');
    const li = document.createElement('li');
    li.innerHTML = `
        <div style="flex-grow:1; text-align:left;" onclick="sendCommand('NAME:${name}');sendCommand('PLAY_URL:${url}')">
            <b>${name}</b><br><small style="color:#555; font-size:0.6rem;">${url}</small>
        </div>
        <div style="display:flex; gap:10px;">
            <button class="retro-btn small" onclick="playLocally('${url}','${name}')">📱</button>
            <button class="retro-btn small" onclick="deleteStation(${idx})" style="color:red; border-color:#522;">X</button>
        </div>`;
    list.appendChild(li);

    const dial = document.getElementById('stationScroll');
    const div = document.createElement('div');
    div.className = "dial-item"; div.innerText = name.toUpperCase(); dial.appendChild(div);
}

function syncTuningDial(name) {
    const dial = document.getElementById('stationScroll');
    const items = dial.getElementsByClassName('dial-item');
    for (let i = 0; i < items.length; i++) {
        if (items[i].innerText.toUpperCase() === name.toUpperCase()) {
            dial.style.transform = `translateX(${i * -120}px)`;
            Array.from(items).forEach(el => el.classList.remove('active'));
            items[i].classList.add('active');
            break;
        }
    }
}

function playLocally(url, name) {
    if (mobilePlayer.src === url && !mobilePlayer.paused) { mobilePlayer.pause(); } 
    else { mobilePlayer.src = url; mobilePlayer.play(); document.getElementById('nowPlaying').innerText = "MOBILE: " + name.toUpperCase(); }
}

function deleteStation(idx) { if(confirm("ERASE?")) { sendCommand(`DEL:${idx}`); setTimeout(refreshList, 1000); } }
function addStation() {
    const n = document.getElementById('newStationName').value, u = document.getElementById('newStationUrl').value;
    if (n && u) { sendCommand(`ADD:${n}|${u}`); setTimeout(refreshList, 1000); }
}
function saveBuffer() { sendCommand(`BUFFER:${document.getElementById('bufferSize').value}`); }
function sendWiFi() { sendCommand(`WIFI:${document.getElementById('wifiSSID').value}|${document.getElementById('wifiPass').value}`); }

function openTab(t) {
    Array.from(document.getElementsByClassName("tab-content")).forEach(x => x.classList.remove("active"));
    Array.from(document.getElementsByClassName("tab-link")).forEach(l => l.classList.remove("active"));
    document.getElementById(t).classList.add("active");
    event.currentTarget.classList.add("active");
}

document.getElementById('connectBtn').addEventListener('click', connectToBLE);
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }