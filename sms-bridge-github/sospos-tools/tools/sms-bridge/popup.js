// popup.js — SOS Messenger v2.3

const $ = id => document.getElementById(id);
const INFO_BYTES = new TextEncoder().encode('sms-bridge-v1');
const SALT_BYTES = new Uint8Array(32);
const NGROK_HDR  = { 'ngrok-skip-browser-warning': '1' };

// ── Tab switching ─────────────────────────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $('tab-' + id).classList.add('active');
  $('tab' + id.charAt(0).toUpperCase() + id.slice(1)).classList.add('active');
  if (id === 'history') loadHistory();
  if (id === 'pair')    { updateServerDisplay(); loadDevices(); }
}
$('tabSend').addEventListener('click',    () => showTab('send'));
$('tabHistory').addEventListener('click', () => showTab('history'));
$('tabPair').addEventListener('click',    () => showTab('pair'));

// ── Crypto ────────────────────────────────────────────────────────────────────
async function importPublicKey(b64) {
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', der.buffer, { name:'ECDH', namedCurve:'P-256' }, true, []);
}
async function exportPublicKey(key) {
  const der = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(der)));
}
async function deriveAesKey(priv, pub) {
  const shared = await crypto.subtle.deriveKey(
    { name:'ECDH', public:pub }, priv, { name:'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'HKDF', hash:'SHA-256', salt:SALT_BYTES, info:INFO_BYTES },
    shared, { name:'AES-GCM', length:256 }, false, ['encrypt']
  );
}
async function encryptMessage(plaintext, recipientPubKeyB64) {
  const recipientKey = await importPublicKey(recipientPubKeyB64);
  const ephemeral    = await crypto.subtle.generateKey({ name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey']);
  const aesKey       = await deriveAesKey(ephemeral.privateKey, recipientKey);
  const iv           = crypto.getRandomValues(new Uint8Array(12));
  const enc          = new Uint8Array(await crypto.subtle.encrypt(
    { name:'AES-GCM', iv, additionalData:INFO_BYTES },
    aesKey, new TextEncoder().encode(plaintext)
  ));
  const toB64 = b => btoa(String.fromCharCode(...b));
  return { v:1, epk: await exportPublicKey(ephemeral.publicKey),
    iv:toB64(iv), tag:toB64(enc.slice(enc.length-16)), ct:toB64(enc.slice(0,enc.length-16)) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSettings() {
  return new Promise(resolve => chrome.storage.local.get(['server','apikey','device_pubkey'], resolve));
}
async function apiFetch(path, options={}) {
  const { server, apikey } = await getSettings();
  if (!server || !apikey) throw new Error('Not configured');
  return fetch(`${server}/api/tools/sms-bridge${path}`, {
    ...options,
    headers: { 'x-api-key':apikey, ...NGROK_HDR, ...(options.headers||{}) }
  });
}

function formatDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  // Format: 29 May 2026, 3:01 pm
  return date.toLocaleString('en-AU', { timeZone:'Australia/Brisbane',
    day:'numeric', month:'short', year:'numeric',
    hour:'numeric', minute:'2-digit', hour12:true
  });
}

function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function setStatus(msg,cls){ $('status').textContent=msg; $('status').className=cls; }
function updateEncStatus(key){
  $('encStatus').textContent = key ? '🔒 Encrypted' : '⚠️ No device key';
  $('encStatus').style.color = key ? '#2d8a4e' : '#e65100';
}
async function updateServerDisplay() {
  const { server } = await getSettings();
  $('serverDisplay').textContent = server || 'not set';
}

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['server','apikey','device_pubkey','configured'], data => {
  if (!data.configured && typeof SOS_CONFIG !== 'undefined') {
    chrome.storage.local.set({ server:SOS_CONFIG.serverUrl, apikey:SOS_CONFIG.apiKey, configured:true });
    $('server').value = SOS_CONFIG.serverUrl || '';
    $('apikey').value = SOS_CONFIG.apiKey    || '';
  } else {
    if (data.server) $('server').value = data.server;
    if (data.apikey) $('apikey').value = data.apikey;
  }
  updateEncStatus(data.device_pubkey);
  fetchDeviceKey();
});

// ── Settings ──────────────────────────────────────────────────────────────────
$('save').addEventListener('click', () => {
  chrome.storage.local.set({ server:$('server').value.trim(), apikey:$('apikey').value.trim(), configured:true });
  fetchDeviceKey(); setStatus('Settings saved','ok');
});
$('resetDefaults').addEventListener('click', () => {
  if (typeof SOS_CONFIG !== 'undefined') {
    $('server').value = SOS_CONFIG.serverUrl||'';
    $('apikey').value = SOS_CONFIG.apiKey||'';
    chrome.storage.local.set({ server:SOS_CONFIG.serverUrl, apikey:SOS_CONFIG.apiKey, configured:true });
    fetchDeviceKey(); setStatus('Reset to defaults','ok');
  }
});
$('refreshKey').addEventListener('click', () => { $('encStatus').textContent='Refreshing…'; fetchDeviceKey(); });

async function fetchDeviceKey() {
  try {
    const r    = await apiFetch('/devices');
    const data = await r.json();
    const dev  = data.devices?.find(d => d.public_key);
    const key  = dev?.public_key || null;
    chrome.storage.local.set({ device_pubkey: key });
    updateEncStatus(key);
    return key;
  } catch { updateEncStatus(null); return null; }
}

// ── Send ──────────────────────────────────────────────────────────────────────
$('send').addEventListener('click', async () => {
  const phone   = $('phone').value.trim();
  const message = $('message').value.trim();
  if (!phone || !message) return setStatus('Fill in both fields','err');
  $('send').disabled = true;
  try {
    const { device_pubkey } = await getSettings();
    const pubKey = device_pubkey || await fetchDeviceKey();
    const bodyPayload = pubKey
      ? { phone, encrypted_message: await encryptMessage(message, pubKey) }
      : { phone, message };
    const res  = await apiFetch('/send', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(bodyPayload) });
    const data = await res.json();
    if (data.ok) {
      setStatus(data.encrypted ? '✅ Sent 🔒 encrypted' : '✅ Queued','ok');
      $('phone').value=''; $('message').value='';
    } else setStatus(data.error||'Server error','err');
  } catch { setStatus('Could not reach server','err'); }
  finally { $('send').disabled=false; }
});

// ── History — newest first, full date/time ────────────────────────────────────
$('btnRefreshHistory').addEventListener('click', loadHistory);
async function loadHistory() {
  const list=$('msgList'); list.innerHTML='<div class="empty">Loading…</div>';
  try {
    const r=await apiFetch('/history?limit=100'); const data=await r.json();
    // Sort newest first
    const msgs=(data.messages||[]).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    if (!msgs.length) { list.innerHTML='<div class="empty">No messages yet</div>'; return; }
    list.innerHTML=msgs.map(m=>`
      <div class="msg-item">
        <div class="msg-phone">${escHtml(m.phone)}</div>
        <div class="msg-text">${m.encrypted?'🔒 [encrypted]':escHtml(m.message||'')}</div>
        <div class="msg-meta">
          <span class="badge badge-${m.status}">${m.status}</span>
          ${m.encrypted?'<span class="badge badge-enc">E2E</span>':''}
          <span>${formatDateTime(m.created_at)}</span>
        </div>
      </div>`).join('');
  } catch { list.innerHTML='<div class="empty">Could not load</div>'; }
}

// ── Pair — single QR, no duplicates ──────────────────────────────────────────
$('btnGenCode').addEventListener('click', generatePairingCode);
$('btnRefreshDevices').addEventListener('click', loadDevices);

let qrInstance = null;

async function generatePairingCode() {
  $('pairStatus').textContent='Generating…'; $('qrSection').style.display='none';
  try {
    const r=await apiFetch('/generate-code',{method:'POST'}); const data=await r.json();
    if (!data.ok) { $('pairStatus').textContent='❌ '+(data.error||'Failed'); return; }
    $('pairCode').textContent = data.code;
    $('pairStatus').textContent = '⏱ Expires in 15 minutes';
    $('qrSection').style.display = 'block';

    // Clear previous QR completely before drawing new one
    const wrap = $('qrCanvas');
    wrap.innerHTML = '';
    qrInstance = null;

    const { server } = await getSettings();
    if (typeof QRCode !== 'undefined') {
      qrInstance = new QRCode(wrap, {
        text: JSON.stringify({ server, code: data.code }),
        width: 160,
        height: 160,
        correctLevel: QRCode.CorrectLevel.M
      });
    }
    setTimeout(loadDevices, 12000);
  } catch { $('pairStatus').textContent='❌ Could not reach server'; }
}

async function loadDevices() {
  const el=$('deviceList');
  el.innerHTML='<span style="color:#aaa">Loading…</span>';
  try {
    const r=await apiFetch('/devices'); const data=await r.json();
    const devs=data.devices||[];
    if (!devs.length) { el.textContent='No devices linked yet'; return; }
    el.innerHTML=devs.map(d=>`
      <div class="device-item">
        <div>
          <span style="font-weight:500">📱 ${escHtml(d.label||'Phone')}</span>
          <span style="color:#999;margin-left:6px;font-size:11px">${d.device_id.substring(0,8)}…</span>
          ${d.public_key
            ? '<span style="color:#2d8a4e;margin-left:4px">🔒 key OK</span>'
            : '<span style="color:#e65100;margin-left:4px">⚠️ no key</span>'}
        </div>
        <div style="color:#aaa;font-size:11px;margin-top:2px">Last seen ${formatDateTime(d.last_seen)}</div>
      </div>`).join('');
    const dev = devs.find(d => d.public_key);
    if (dev) { chrome.storage.local.set({ device_pubkey: dev.public_key }); updateEncStatus(dev.public_key); }
  } catch { el.textContent='Could not load devices'; }
}
