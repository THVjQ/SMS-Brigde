// js/app.js — views, state and the sync loop.

(() => {
  'use strict';

  const $  = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  const state = {
    view: 'messages',
    threadKey: null,
    draftThread: null,      // a conversation being started that has no messages yet
    devices: [],
    defaultDeviceId: null,
    keyPair: null,          // { publicKeyB64, keyId, privateKey }
    conversations: [],
    marks: {},
    unreadOnly: false,
    search: '',
    adminStatus: 'pending',
    syncing: false,
  };

  // ══ Formatting ═══════════════════════════════════════════════════════════

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * SQLite writes CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" in UTC, with no zone marker. Passing
   * that straight to Date() makes the browser read it as local time, which silently shifts every
   * timestamp by the UTC offset — ten hours here, enough to file this morning's messages under
   * tomorrow. The Z is not optional.
   */
  function parseTs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const t = Date.parse(/[TZ]/.test(value) ? value : value.replace(' ', 'T') + 'Z');
    return Number.isNaN(t) ? 0 : t;
  }

  const pad = n => String(n).padStart(2, '0');
  const clockOf = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function shortTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return clockOf(d);
    if (now - ts < 6 * 864e5) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7)  return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const fullTime = ts => ts ? new Date(ts).toLocaleString() : '—';

  /**
   * Two spellings of one phone number have to land in one conversation: the phone reports inbound
   * as +61412345678 while the operator typed 0412345678. Comparing the last nine digits merges
   * those without needing to know the country.
   */
  function threadKeyOf(number) {
    const digits = String(number || '').replace(/\D/g, '');
    return digits.length > 9 ? digits.slice(-9) : (digits || String(number || '').trim());
  }

  function prettyNumber(raw) {
    const s = String(raw || '').trim();
    const digits = s.replace(/\D/g, '');
    if (/^\+61/.test(s) && digits.length === 11) return `+61 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    if (/^0/.test(s)   && digits.length === 10) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    return s;
  }

  // Straight from shared/AvatarColors.kt, so a contact is the same colour in both clients.
  const ALPHA_COLORS = ['#1565C0','#1976D2','#0288D1','#0097A7','#00838F','#00796B','#2E7D32','#388E3C',
    '#558B2F','#827717','#F9A825','#F57F17','#E65100','#BF360C','#B71C1C','#C62828','#D32F2F','#AD1457',
    '#C2185B','#E91E63','#880E4F','#6A1B9A','#7B1FA2','#8E24AA','#6200EA','#311B92'];
  const DIGIT_COLORS = ['#0D47A1','#006064','#004D40','#1B5E20','#33691E','#E65100','#8D1F1F','#880E4F','#4A148C','#1A237E'];

  function avatarColor(key) {
    const ch = String(key || '')[0] || '';
    if (/[a-z]/i.test(ch)) return ALPHA_COLORS[Math.min(25, ch.toUpperCase().charCodeAt(0) - 65)];
    if (/\d/.test(ch))     return DIGIT_COLORS[+ch];
    return ALPHA_COLORS[0];
  }

  function initialsOf(name) {
    const s = String(name || '').trim();
    const letters = s.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
    const digits = s.replace(/\D/g, '');
    return digits ? digits.slice(-2) : (s.slice(0, 2).toUpperCase() || '#');
  }

  const avatarHtml = (name, cls = '') =>
    `<div class="avatar ${cls}" style="background:${avatarColor(initialsOf(name))}">${esc(initialsOf(name))}</div>`;

  /** Links are clickable in the app's bubbles (Linkify + LinkMovementMethod), so they are here too. */
  function linkify(text) {
    return esc(text).replace(/\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)"'])/gi, url => {
      const href = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    });
  }

  // ══ Chrome: toast + sheet ════════════════════════════════════════════════

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('toast--err', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  const errText = e => (e && e.message) || 'Something went wrong';

  function openSheet(title, html) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#scrim').hidden = false;
    return $('#sheetBody');
  }

  function closeSheet() {
    $('#scrim').hidden = true;
    $('#sheetBody').innerHTML = '';
  }

  async function copy(text, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast('Could not copy — select the text instead', true);
    }
  }

  // ══ Theme ════════════════════════════════════════════════════════════════

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('nexlink.theme', theme);
    const dark = theme === 'dark' ||
      (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#000000' : '#f2f2f7';
  }

  // ══ Sign-in ══════════════════════════════════════════════════════════════

  function showAuth() {
    $('#appShell').hidden = true;
    $('#authScreen').hidden = false;
    checkHealth();
  }

  async function checkHealth() {
    const dot = $('#authHealthDot');
    const label = $('#authHealth');
    try {
      const h = await Api.health();
      dot.className = 'dot dot--ok';
      label.textContent = h.ok ? 'Server online' : 'Server reachable';
    } catch {
      dot.className = 'dot dot--down';
      label.textContent = 'Server unreachable';
    }
  }

  function wireAuth() {
    $$('[data-authtab]').forEach(btn => btn.addEventListener('click', () => {
      const tab = btn.dataset.authtab;
      $$('[data-authtab]').forEach(b => b.classList.toggle('is-active', b === btn));
      $('#loginForm').hidden    = tab !== 'login';
      $('#registerForm').hidden = tab !== 'register';
    }));

    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target;
      const msg  = $('#loginMsg');
      const btn  = form.querySelector('button[type=submit]');
      msg.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        await Api.login(form.username.value.trim(), form.password.value);
        form.reset();
        await enterApp();
      } catch (err) {
        msg.className = 'formmsg';
        msg.textContent = errText(err);
        msg.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });

    $('#registerForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target;
      const msg  = $('#registerMsg');
      const btn  = form.querySelector('button[type=submit]');
      msg.hidden = true;
      btn.disabled = true;
      try {
        const out = await Api.register(form.username.value.trim(), form.password.value);
        msg.className = 'formmsg formmsg--ok';
        msg.textContent = out.message || 'Account requested.';
        msg.hidden = false;
        form.reset();
        if (!out.pending) $('[data-authtab="login"]').click();
      } catch (err) {
        msg.className = 'formmsg';
        msg.textContent = errText(err);
        msg.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ══ Identity key ═════════════════════════════════════════════════════════

  /**
   * Inbound is encrypted to the desktops' keys, one envelope each, so this browser has to own a
   * keypair and tell the server its public half — until it does, replies arrive that it cannot
   * open. Registration is an upsert keyed on the key id, so running it at every sign-in just
   * refreshes last_seen.
   */
  async function ensureClientKey() {
    const account = Api.accountId();
    let record = await Store.getKeyPair(account);

    if (!record) {
      const pair = await NexCrypto.generateKeyPair();
      const publicKeyB64 = await NexCrypto.exportPublic(pair.publicKey);
      record = {
        publicKeyB64,
        keyId: await NexCrypto.keyIdFor(publicKeyB64),
        privateKey: pair.privateKey,
      };
      await Store.putKeyPair(account, record);
    }

    state.keyPair = record;
    try {
      await Api.registerClientKey(record.publicKeyB64, `Web · ${Api.browserLabel()}`);
    } catch (e) {
      toast(`Could not register this browser's key: ${errText(e)}`, true);
    }
  }

  // ══ Sync ═════════════════════════════════════════════════════════════════

  async function sync({ quiet = true } = {}) {
    if (state.syncing || !Api.isAuthed()) return;
    state.syncing = true;
    try {
      const account = Api.accountId();
      const [devicesOut, incomingOut, historyOut, marks] = await Promise.all([
        Api.devices(), Api.incoming(), Api.history(300), Store.readMarks(account),
      ]);

      state.devices = devicesOut.devices || [];
      state.defaultDeviceId = devicesOut.default_device_id || null;
      state.marks = marks || {};

      await absorbIncoming(account, incomingOut.messages || []);
      await absorbHistory(account, historyOut.messages || []);
      await rebuildConversations(account);

      render();
    } catch (e) {
      if (!quiet) toast(errText(e), true);
    } finally {
      state.syncing = false;
    }
  }

  /** Opens each new inbound row once and keeps the plaintext locally. */
  async function absorbIncoming(account, rows) {
    const known = await Store.knownInboundIds(account);

    for (const row of rows) {
      if (known.has(row.id)) continue;

      let text = null;
      let readable = true;

      if (row.e2e) {
        const envelope = row.envelopes && state.keyPair && row.envelopes[state.keyPair.keyId];
        if (!envelope) {
          // The phone encrypted this before it knew about this browser. Nothing here can open it,
          // and saying so is better than showing an empty message.
          text = '[Encrypted for another device — this browser was not registered yet]';
          readable = false;
        } else {
          try {
            text = await NexCrypto.decrypt(envelope, state.keyPair.privateKey);
          } catch {
            text = '[Could not decrypt this message]';
            readable = false;
          }
        }
      } else {
        // Legacy rows: encrypted to the server's own key, which means the server read them.
        text = row.message;
      }

      await Store.putInbound(account, {
        id: row.id, sender: row.sender, text, at: parseTs(row.received_at), e2e: !!row.e2e, readable,
      });
    }
  }

  /** /history carries no message body, only the status — the text is already in the local outbox. */
  async function absorbHistory(account, rows) {
    for (const row of rows) await Store.setOutboundStatus(account, row.id, row.status);
  }

  async function rebuildConversations(account) {
    const [outbound, inbound] = await Promise.all([Store.listOutbound(account), Store.listInbound(account)]);
    const threads = new Map();

    const threadFor = (number) => {
      const key = threadKeyOf(number);
      if (!threads.has(key)) {
        threads.set(key, { key, display: prettyNumber(number), raw: number, messages: [], lastAt: 0, unread: 0 });
      }
      return threads.get(key);
    };

    for (const row of outbound) {
      threadFor(row.phone).messages.push({
        dir: 'out', text: row.text, at: row.at, status: row.status, id: row.id,
      });
    }
    for (const row of inbound) {
      const t = threadFor(row.sender);
      t.messages.push({ dir: 'in', text: row.text, at: row.at, id: row.id, readable: row.readable });
      // Inbound carries the number as the network reports it, which is the more canonical spelling.
      t.display = prettyNumber(row.sender);
      t.raw = row.sender;
    }

    if (state.draftThread && !threads.has(state.draftThread.key)) {
      threads.set(state.draftThread.key, { ...state.draftThread, messages: [], lastAt: Date.now() });
    }

    for (const t of threads.values()) {
      t.messages.sort((a, b) => a.at - b.at);
      t.lastAt = t.messages.length ? t.messages[t.messages.length - 1].at : t.lastAt;
      const mark = state.marks[t.key] || 0;
      t.unread = t.messages.filter(m => m.dir === 'in' && m.at > mark).length;
      const last = t.messages[t.messages.length - 1];
      t.preview = last ? (last.dir === 'out' ? `You: ${last.text}` : last.text) : 'No messages yet';
    }

    state.conversations = [...threads.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  const totalUnread = () => state.conversations.reduce((n, t) => n + t.unread, 0);

  // ══ Render ═══════════════════════════════════════════════════════════════

  function render() {
    renderNav();
    if (state.view === 'messages') { renderConversations(); renderThread(); }
    if (state.view === 'devices')  renderDevices();
    if (state.view === 'settings') renderSettings();
    if (state.view === 'admin')    renderAdmin();
  }

  function renderNav() {
    const unread = totalUnread();
    for (const id of ['#railBadge', '#navBadge']) {
      const el = $(id);
      if (el) el.hidden = unread === 0;
    }
    const admin = !!(Api.get() && Api.get().is_admin);
    $('#railAdmin').hidden = !admin;
    $('#navAdmin').hidden  = !admin;
    $$('[data-nav]').forEach(b => b.classList.toggle('is-active', b.dataset.nav === state.view));
    $('#appShell').dataset.view = state.view;

    const title = document.title.split(' — ')[0];
    document.title = unread ? `(${unread}) ${title}` : title;
  }

  function renderConversations() {
    const list = $('#convList');
    const term = state.search.trim().toLowerCase();

    let rows = state.conversations;
    if (state.unreadOnly) rows = rows.filter(t => t.unread > 0);
    if (term) {
      rows = rows.filter(t =>
        t.display.toLowerCase().includes(term) ||
        t.key.includes(term.replace(/\D/g, '')) && !!term.replace(/\D/g, '') ||
        t.messages.some(m => String(m.text).toLowerCase().includes(term)));
    }

    const unread = totalUnread();
    $('#messagesSub').textContent = state.conversations.length
      ? `${state.conversations.length} conversation${state.conversations.length === 1 ? '' : 's'}${unread ? ` · ${unread} unread` : ''}`
      : ' ';
    $('#filterUnread').classList.toggle('is-active', state.unreadOnly);

    if (!rows.length) {
      list.innerHTML = `<div class="empty">
        <svg class="empty__icon"><use href="#i-message"/></svg>
        <p>${state.conversations.length ? 'Nothing matches' : 'No messages yet'}</p>
        <span>${state.conversations.length
          ? 'Try a different search, or clear the unread filter.'
          : 'Start one with the compose button, or wait for a reply to arrive from a paired phone.'}</span>
      </div>`;
      return;
    }

    list.innerHTML = rows.map(t => `
      <button class="conv ${t.unread ? 'is-unread' : ''} ${t.key === state.threadKey ? 'is-active' : ''}" data-thread="${esc(t.key)}">
        ${avatarHtml(t.display)}
        <div class="conv__main">
          <div class="conv__top">
            <span class="conv__name">${esc(t.display)}</span>
            <svg class="conv__lock"><use href="#i-lock"/></svg>
            <span class="conv__time">${esc(shortTime(t.lastAt))}</span>
          </div>
          <div class="conv__bot">
            <span class="conv__prev">${esc(t.preview)}</span>
            ${t.unread ? `<span class="badge">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
          </div>
        </div>
      </button>`).join('');
  }

  const currentThread = () => state.conversations.find(t => t.key === state.threadKey) || null;

  function renderThread() {
    const t = currentThread();
    const body = $('#threadBody');

    if (!t) {
      $('#threadHead').hidden = true;
      $('#composer').hidden = true;
      body.innerHTML = `<div class="empty">
        <svg class="empty__icon"><use href="#i-message"/></svg>
        <p>Pick a conversation</p>
        <span>Messages you send from here are encrypted in this browser before they reach the server.</span>
      </div>`;
      return;
    }

    $('#threadHead').hidden = false;
    $('#composer').hidden = false;
    $('#threadName').textContent = t.display;
    $('#threadAvatar').textContent = initialsOf(t.display);
    $('#threadAvatar').style.background = avatarColor(initialsOf(t.display));

    const target = targetDevice();
    $('#threadMeta').textContent = target
      ? `Encrypted · via ${target.label || target.device_id.slice(0, 8)}`
      : 'No phone paired';

    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    let html = '';
    let lastDay = '';

    for (const m of t.messages) {
      const day = m.at ? new Date(m.at).toDateString() : '';
      if (day && day !== lastDay) {
        html += `<div class="daysep">${esc(dayLabel(m.at))}</div>`;
        lastDay = day;
      }
      html += `<div class="bubble bubble--${m.dir === 'out' ? 'out' : 'in'}">${linkify(m.text)}</div>`;
      html += m.dir === 'out' ? outMeta(m) : `<div class="bubblemeta bubblemeta--in">${esc(clockOf(new Date(m.at)))}</div>`;
    }

    // The stream is wrapped so it can be pushed to the bottom with margin-top:auto. Doing that with
    // justify-content on the scroller instead makes overflowing messages unreachable above the
    // scroll origin, which is a long-standing flexbox trap.
    body.innerHTML = html
      ? `<div class="thread__stream">${html}</div>`
      : `<div class="empty"><p>No messages yet</p><span>Say something — it will be queued for the paired phone to send.</span></div>`;
    if (atBottom) body.scrollTop = body.scrollHeight;

    markRead(t);
  }

  function outMeta(m) {
    const label = {
      pending: 'Queued',
      claimed: 'Sending…',
      sent:    'Sent',
      failed:  'Failed to send',
    }[m.status] || m.status || '';
    const failed = m.status === 'failed';
    return `<div class="bubblemeta bubblemeta--out ${failed ? 'bubblemeta--failed' : ''}">
      ${esc(clockOf(new Date(m.at)))} · ${esc(label)}
      ${m.status === 'sent' ? '<svg><use href="#i-check"/></svg>' : ''}
    </div>`;
  }

  async function markRead(t) {
    const newest = t.messages.filter(m => m.dir === 'in').reduce((max, m) => Math.max(max, m.at), 0);
    if (!newest || (state.marks[t.key] || 0) >= newest) return;
    state.marks[t.key] = newest;
    t.unread = 0;
    await Store.setReadMark(Api.accountId(), t.key, newest);
    renderNav();
    renderConversations();
  }

  // ══ Sending ══════════════════════════════════════════════════════════════

  /** Which phone a message goes to: the account default, or the only one paired. */
  function targetDevice() {
    if (state.defaultDeviceId) {
      const found = state.devices.find(d => d.device_id === state.defaultDeviceId);
      if (found) return found;
    }
    return state.devices.length === 1 ? state.devices[0] : null;
  }

  async function sendCurrent() {
    const input = $('#composerInput');
    const text = input.value.trim();
    const t = currentThread();
    if (!text || !t) return;

    // The shell is on screen before the first sync finishes, so someone typing straight away can
    // reach here with an empty device list. That is not the same thing as having no phone — settle
    // the question before refusing.
    let device = targetDevice();
    if (!device && !state.devices.length) {
      await sync();
      device = targetDevice();
    }
    if (!device) {
      toast(state.devices.length ? 'Choose a default phone in Devices first' : 'No phone is paired yet', true);
      return;
    }
    if (!device.public_key) {
      toast('That phone has no encryption key — re-pair it from the phone', true);
      return;
    }

    const btn = $('#sendBtn');
    btn.disabled = true;
    try {
      // Encrypted here, in the browser. The server stores an envelope only it cannot open, which is
      // the whole point of the bridge — sending the plaintext and letting the server encrypt would
      // work too, and would hand it every message.
      const envelope = await NexCrypto.encrypt(text, device.public_key);
      const out = await Api.send({
        phone: t.raw || t.display,
        encrypted_message: envelope,
        device_id: device.device_id,
      });

      await Store.putOutbound(Api.accountId(), {
        id: out.id, phone: t.raw || t.display, text, at: Date.now(), status: 'pending',
        deviceId: device.device_id,
      });

      input.value = '';
      input.style.height = 'auto';
      state.draftThread = null;
      await rebuildConversations(Api.accountId());
      render();
      $('#threadBody').scrollTop = $('#threadBody').scrollHeight;
    } catch (e) {
      // The text stays in the box: a failed send must not silently eat what was typed.
      toast(errText(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  function composeSheet() {
    openSheet('New message', `
      <form id="composeForm">
        <label class="field">
          <span class="field__label">Phone number</span>
          <input name="phone" type="tel" inputmode="tel" placeholder="0412 345 678" required autocomplete="tel">
          <span class="field__hint">Any format — spaces and +61 are fine.</span>
        </label>
        <button type="submit" class="btn btn--primary btn--block">Start conversation</button>
      </form>`);

    $('#composeForm').addEventListener('submit', async e => {
      e.preventDefault();
      const raw = e.target.phone.value.trim();
      if (!raw.replace(/\D/g, '')) return;
      const key = threadKeyOf(raw);
      state.draftThread = { key, display: prettyNumber(raw), raw, unread: 0, preview: 'No messages yet' };
      state.threadKey = key;
      closeSheet();
      await rebuildConversations(Api.accountId());
      openThread(key);
    });
  }

  function openThread(key) {
    state.threadKey = key;
    $('#appShell').dataset.pane = 'thread';
    render();
    const body = $('#threadBody');
    body.scrollTop = body.scrollHeight;
    if (matchMedia('(min-width: 900px)').matches) $('#composerInput').focus();
  }

  // ══ Devices ══════════════════════════════════════════════════════════════

  function renderDevices() {
    const wrap = $('#deviceList');

    if (!state.devices.length) {
      wrap.innerHTML = `<div class="empty">
        <svg class="empty__icon"><use href="#i-phone"/></svg>
        <p>No phone paired</p>
        <span>Pair the NexLink app on a phone and it will send the SMS this server queues.</span>
      </div>`;
      return;
    }

    wrap.innerHTML = state.devices.map(d => {
      const isDefault = d.device_id === state.defaultDeviceId;
      return `<div class="card">
        <div class="card__head">
          ${avatarHtml(d.label || 'Phone', 'avatar--sm')}
          <h3>${esc(d.label || 'Phone')}</h3>
          ${isDefault ? '<span class="tag tag--accent">Default</span>' : ''}
          ${d.public_key ? '<span class="tag tag--ok">Encrypted</span>' : '<span class="tag tag--danger">No key</span>'}
        </div>
        <div class="card__row"><span class="k">Device ID</span><span class="v mono">${esc(d.device_id)}</span></div>
        <div class="card__row"><span class="k">Paired</span><span class="v">${esc(fullTime(parseTs(d.paired_at)))}</span></div>
        <div class="card__row"><span class="k">Last seen</span><span class="v">${esc(d.last_seen ? fullTime(parseTs(d.last_seen)) : 'Never')}</span></div>
        <div class="card__actions">
          ${isDefault ? '' : `<button class="btn btn--sm" data-default="${esc(d.device_id)}">Make default</button>`}
          <button class="btn btn--sm btn--danger" data-unpair="${esc(d.device_id)}"><svg><use href="#i-trash"/></svg> Unpair</button>
        </div>
        ${d.public_key ? '' : '<p class="card__note">Without a key this phone cannot be sent anything — re-pair it from the app.</p>'}
      </div>`;
    }).join('');
  }

  async function pairSheet() {
    const body = openSheet('Pair a phone', '<p class="card__note">Requesting a code…</p>');
    let out;
    try {
      out = await Api.pairingCode();
    } catch (e) {
      body.innerHTML = `<div class="formmsg">${esc(errText(e))}</div>`;
      return;
    }

    body.innerHTML = `
      <div class="paircode" id="pairCode">${esc(out.code)}</div>
      <div class="card__actions" style="margin-top:0">
        <button class="btn btn--sm" id="copyCode"><svg><use href="#i-copy"/></svg> Copy code</button>
        <span class="tag" id="pairCountdown"></span>
      </div>
      <p class="sectiontitle">On the phone</p>
      <ol class="steps">
        <li>Open <strong>NexLink</strong>.</li>
        <li>Go to <strong>Settings → Computer Bridge</strong>.</li>
        <li>Work through the setup: accept the notice, enter this server's URL, then this code.</li>
      </ol>
      <p class="card__note">The phone leaves pairing with its own API key, scoped to this account. Pairing again replaces the previous key, so a phone that was wiped or handed on stops working.</p>`;

    $('#copyCode').addEventListener('click', () => copy(out.code, 'Pairing code copied'));

    let left = out.expires_in || 900;
    const countdown = $('#pairCountdown');
    const tick = () => {
      if (left <= 0) {
        countdown.textContent = 'Expired';
        countdown.className = 'tag tag--danger';
        clearInterval(timer);
        return;
      }
      countdown.textContent = `Expires in ${Math.floor(left / 60)}:${pad(left % 60)}`;
      left -= 1;
    };
    const timer = setInterval(() => { if ($('#scrim').hidden) return clearInterval(timer); tick(); }, 1000);
    tick();
  }

  // ══ Settings ═════════════════════════════════════════════════════════════

  async function renderSettings() {
    const s = Api.get();
    const user = (s && s.user) || {};
    const theme = localStorage.getItem('nexlink.theme') || 'system';

    $('#settingsBody').innerHTML = `
      <div class="card">
        <div class="card__head">
          ${avatarHtml(user.username || '?', 'avatar--sm')}
          <h3>${esc(user.username || 'Signed in')}</h3>
          ${user.role === 'admin' ? '<span class="tag tag--accent">Admin</span>' : ''}
          <span class="tag tag--ok">${esc(user.status || 'active')}</span>
        </div>
        <div class="card__row"><span class="k">Account</span><span class="v">#${esc(user.account_id ?? '—')}</span></div>
        <div class="card__row"><span class="k">Member since</span><span class="v">${esc(fullTime(parseTs(user.created_at)))}</span></div>
        <div class="card__row"><span class="k">Last sign-in</span><span class="v">${esc(fullTime(parseTs(user.last_login)))}</span></div>
      </div>

      <p class="sectiontitle">Encryption</p>
      <div class="card">
        <div class="card__head"><svg style="color:var(--accent)"><use href="#i-key"/></svg><h3>This browser's key</h3></div>
        <div class="card__row"><span class="k">Key ID</span><span class="v mono">${esc(state.keyPair ? state.keyPair.keyId : '—')}</span></div>
        <p class="card__note">Replies from the phone are encrypted to this key. The private half was generated here as a
        non-extractable key — it can decrypt, but nothing can read it back out of the browser, including this page.
        Clearing site data destroys it, and messages that arrived before a new key is registered cannot be recovered.</p>
        <div id="otherKeys"></div>
      </div>

      <p class="sectiontitle">Appearance</p>
      <div class="card">
        <div class="segmented" id="themePicker">
          <button class="segmented__btn ${theme === 'system' ? 'is-active' : ''}" data-theme="system">System</button>
          <button class="segmented__btn ${theme === 'light'  ? 'is-active' : ''}" data-theme="light">Light</button>
          <button class="segmented__btn ${theme === 'dark'   ? 'is-active' : ''}" data-theme="dark">Dark</button>
        </div>
      </div>

      <p class="sectiontitle">Password</p>
      <div class="card">
        <form id="pwForm">
          <label class="field"><span class="field__label">Current password</span>
            <input name="current" type="password" autocomplete="current-password" required></label>
          <label class="field"><span class="field__label">New password</span>
            <input name="next" type="password" autocomplete="new-password" minlength="10" required>
            <span class="field__hint">At least 10 characters</span></label>
          <div id="pwMsg" class="formmsg" hidden></div>
          <button type="submit" class="btn btn--primary">Change password</button>
        </form>
      </div>

      <p class="sectiontitle">Server</p>
      <div class="card" id="serverCard">
        <div class="card__row"><span class="k">Status</span><span class="v" id="srvStatus">Checking…</span></div>
        <div class="card__row"><span class="k">Queued</span><span class="v" id="srvPending">—</span></div>
        <div class="card__row"><span class="k">Sent</span><span class="v" id="srvSent">—</span></div>
        <div class="card__row"><span class="k">Failed</span><span class="v" id="srvFailed">—</span></div>
      </div>

      <p class="sectiontitle">Session</p>
      <div class="card">
        <div class="card__actions" style="margin-top:0">
          <button class="btn btn--sm" id="btnForget">Forget local messages</button>
          <button class="btn btn--sm btn--danger" id="btnSignOut"><svg><use href="#i-logout"/></svg> Sign out</button>
        </div>
        <p class="card__note">Signing out makes this browser forget its API key and its message copies. The key is not
        revoked on the server — ask an administrator to revoke it if this machine is lost.</p>
      </div>`;

    $('#themePicker').addEventListener('click', e => {
      const btn = e.target.closest('[data-theme]');
      if (!btn) return;
      applyTheme(btn.dataset.theme);
      $$('#themePicker [data-theme]').forEach(b => b.classList.toggle('is-active', b === btn));
    });

    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#pwMsg');
      msg.hidden = true;
      try {
        await Api.changePassword(user.username, e.target.current.value, e.target.next.value);
        msg.className = 'formmsg formmsg--ok';
        msg.textContent = 'Password changed.';
        e.target.reset();
      } catch (err) {
        msg.className = 'formmsg';
        msg.textContent = errText(err);
      }
      msg.hidden = false;
    });

    $('#btnSignOut').addEventListener('click', async () => {
      await Store.clearAccount(Api.accountId());
      Api.signOut();
    });

    $('#btnForget').addEventListener('click', async () => {
      await Store.clearAccount(Api.accountId());
      toast('Local copies cleared — inbound will be re-fetched, sent text is gone');
      location.reload();
    });

    // Live bits, filled in after the shell is on screen.
    Api.stats().then(st => {
      $('#srvPending').textContent = (st.pending || 0) + (st.claimed || 0);
      $('#srvSent').textContent    = st.sent || 0;
      $('#srvFailed').textContent  = st.failed || 0;
    }).catch(() => {});

    Api.health()
      .then(() => { $('#srvStatus').innerHTML = '<span class="tag tag--ok">Online</span>'; })
      .catch(() => { $('#srvStatus').innerHTML = '<span class="tag tag--danger">Unreachable</span>'; });

    Api.clientKeys().then(({ keys }) => {
      const others = (keys || []).filter(k => !state.keyPair || k.key_id !== state.keyPair.keyId);
      if (!others.length) return;
      $('#otherKeys').innerHTML = `
        <p class="sectiontitle" style="margin-top:16px">Other registered clients</p>
        ${others.map(k => `<div class="card__row">
          <span class="k mono">${esc(k.key_id)}</span>
          <span class="v">${esc(k.label || 'Unnamed')}</span>
          <button class="iconbtn" data-dropkey="${esc(k.key_id)}" title="Remove"><svg><use href="#i-trash"/></svg></button>
        </div>`).join('')}
        <p class="card__note">Every registered client gets its own copy of each reply. Removing one stops the phone
        encrypting for it.</p>`;
    }).catch(() => {});
  }

  // ══ Admin ════════════════════════════════════════════════════════════════

  const STATUS_TAG = { active: 'tag--ok', pending: 'tag--warn', suspended: 'tag--danger', denied: 'tag--danger' };

  async function renderAdmin() {
    const body = $('#adminBody');
    $$('#adminFilters .chip').forEach(c => c.classList.toggle('is-active', c.dataset.status === state.adminStatus));

    let users = [];
    try {
      users = (await Api.adminUsers(state.adminStatus)).users || [];
    } catch (e) {
      body.innerHTML = `<div class="formmsg">${esc(errText(e))}</div>`;
      return;
    }

    const rows = users.length ? users.map(u => `
      <div class="card">
        <div class="card__head">
          ${avatarHtml(u.username, 'avatar--sm')}
          <h3>${esc(u.username)}</h3>
          ${u.role === 'admin' ? '<span class="tag tag--accent">Admin</span>' : ''}
          <span class="tag ${STATUS_TAG[u.status] || ''}">${esc(u.status)}</span>
        </div>
        <div class="card__row"><span class="k">Account</span><span class="v">#${esc(u.account_id)}</span></div>
        <div class="card__row"><span class="k">Requested</span><span class="v">${esc(fullTime(parseTs(u.created_at)))}</span></div>
        <div class="card__row"><span class="k">Last sign-in</span><span class="v">${esc(fullTime(parseTs(u.last_login)))}</span></div>
        <div class="card__actions">
          ${u.status !== 'active'    ? `<button class="btn btn--sm btn--primary" data-user="${u.id}" data-status="active">Approve</button>` : ''}
          ${u.status === 'pending'   ? `<button class="btn btn--sm btn--danger"  data-user="${u.id}" data-status="denied">Deny</button>` : ''}
          ${u.status === 'active'    ? `<button class="btn btn--sm btn--danger"  data-user="${u.id}" data-status="suspended">Suspend</button>` : ''}
        </div>
      </div>`).join('')
      : `<div class="empty empty--inline"><svg class="empty__icon"><use href="#i-shield"/></svg>
           <p>Nothing here</p><span>No users with that status.</span></div>`;

    body.innerHTML = rows + '<p class="sectiontitle">Accounts</p><div id="acctList"></div>';

    Api.adminAccounts().then(({ accounts }) => {
      $('#acctList').innerHTML = (accounts || []).map(a => `
        <div class="card">
          <div class="card__head"><h3>${esc(a.name)}</h3><span class="tag">#${esc(a.id)}</span></div>
          <div class="card__row"><span class="k">Phones</span><span class="v">${esc(a.devices)}</span></div>
          <div class="card__row"><span class="k">Active keys</span><span class="v">${esc(a.active_keys)}</span></div>
          <div class="card__actions">
            <button class="btn btn--sm" data-mint="${esc(a.id)}"><svg><use href="#i-key"/></svg> Mint API key</button>
          </div>
        </div>`).join('');
    }).catch(() => {});
  }

  async function setUserStatus(id, status) {
    try {
      await Api.setUserStatus(id, status);
      toast(`User ${status}`);
      renderAdmin();
    } catch (e) {
      toast(errText(e), true);
    }
  }

  async function mintKeyFor(accountId) {
    try {
      const out = await Api.mintKey(accountId, `Issued from the web · ${new Date().toISOString().slice(0, 10)}`);
      const body = openSheet('New API key', `
        <p class="card__note" style="margin-bottom:10px">Copy it now. Only its hash is stored, so it can never be shown again.</p>
        <div class="paircode" style="font-size:14px;letter-spacing:.04em">${esc(out.api_key)}</div>
        <button class="btn btn--primary btn--block" id="copyKey"><svg><use href="#i-copy"/></svg> Copy key</button>`);
      body.querySelector('#copyKey').addEventListener('click', () => copy(out.api_key, 'API key copied'));
    } catch (e) {
      toast(errText(e), true);
    }
  }

  // ══ Wiring ═══════════════════════════════════════════════════════════════

  function navigate(view) {
    state.view = view;
    $('#appShell').dataset.pane = 'list';
    $$('.pane').forEach(p => { p.hidden = p.dataset.paneFor !== view; });
    render();
  }

  function wireShell() {
    $$('[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));

    $('#convList').addEventListener('click', e => {
      const row = e.target.closest('[data-thread]');
      if (row) openThread(row.dataset.thread);
    });

    $('#threadBack').addEventListener('click', () => {
      $('#appShell').dataset.pane = 'list';
      state.threadKey = null;
      render();
    });

    $('#btnCompose').addEventListener('click', composeSheet);
    $('#btnPair').addEventListener('click', pairSheet);
    $('#btnRefresh').addEventListener('click', () => sync({ quiet: false }));

    $('#filterUnread').addEventListener('click', () => {
      state.unreadOnly = !state.unreadOnly;
      renderConversations();
    });

    const search = $('#searchInput');
    search.addEventListener('input', () => {
      state.search = search.value;
      $('#searchClear').hidden = !search.value;
      renderConversations();
    });
    $('#searchClear').addEventListener('click', () => {
      search.value = '';
      state.search = '';
      $('#searchClear').hidden = true;
      renderConversations();
    });

    // Composer: Enter sends, Shift+Enter is a newline, and the box grows with the text.
    const input = $('#composerInput');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    });
    $('#composer').addEventListener('submit', e => { e.preventDefault(); sendCurrent(); });

    // One delegated handler for everything rendered as innerHTML.
    document.addEventListener('click', async e => {
      const el = e.target.closest('[data-default],[data-unpair],[data-user],[data-mint],[data-dropkey]');
      if (!el) return;

      if (el.dataset.default) {
        try { await Api.setDefault(el.dataset.default); toast('Default phone updated'); sync(); }
        catch (err) { toast(errText(err), true); }
      }
      if (el.dataset.unpair) {
        const d = state.devices.find(x => x.device_id === el.dataset.unpair);
        if (!confirm(`Unpair "${d ? d.label || d.device_id : el.dataset.unpair}"?\n\nAnything still queued for it will be marked failed.`)) return;
        try { const out = await Api.removeDevice(el.dataset.unpair);
              toast(`Unpaired${out.failed_messages ? ` · ${out.failed_messages} queued message(s) failed` : ''}`); sync(); }
        catch (err) { toast(errText(err), true); }
      }
      if (el.dataset.user)    setUserStatus(el.dataset.user, el.dataset.status);
      if (el.dataset.mint)    mintKeyFor(el.dataset.mint);
      if (el.dataset.dropkey) {
        if (!confirm('Remove this client key? Replies will no longer be encrypted for it.')) return;
        try { await Api.removeClientKey(el.dataset.dropkey); toast('Client key removed'); renderSettings(); }
        catch (err) { toast(errText(err), true); }
      }
    });

    $('#adminFilters').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.adminStatus = chip.dataset.status;
      renderAdmin();
    });

    $('#sheetClose').addEventListener('click', closeSheet);
    $('#scrim').addEventListener('click', e => { if (e.target === $('#scrim')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#scrim').hidden) closeSheet(); });
  }

  // ══ Boot ═════════════════════════════════════════════════════════════════

  let poller;

  async function enterApp() {
    $('#authScreen').hidden = true;
    $('#appShell').hidden = false;
    navigate('messages');

    await ensureClientKey();
    await sync({ quiet: false });

    clearInterval(poller);
    poller = setInterval(() => { if (!document.hidden) sync(); }, 6000);
  }

  function leaveApp() {
    clearInterval(poller);
    state.conversations = [];
    state.threadKey = null;
    state.keyPair = null;
    showAuth();
  }

  async function boot() {
    applyTheme(localStorage.getItem('nexlink.theme') || 'system');
    wireAuth();
    wireShell();
    Api.onSignedOut(leaveApp);

    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

    if (!Api.isAuthed()) return showAuth();

    // A key can be revoked between visits (suspension revokes them), so the stored session is only
    // trustworthy once the server has confirmed it.
    try {
      await Api.refreshMe();
      await enterApp();
    } catch (e) {
      Api.signOut({ silent: true });
      showAuth();
      if (e.code !== 'NETWORK') toast(errText(e), true);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
