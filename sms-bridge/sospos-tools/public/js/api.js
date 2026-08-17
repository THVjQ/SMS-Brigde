// js/api.js — the wire. One place that knows about x-api-key, so nothing else has to.
//
// The page is served by the same Express app that owns the API, so every path here is relative:
// no origin to configure, no CORS preflight, and the key never travels to a third party.
//
// Sign-in mints a normal API key (see db/users.js login) and that key *is* the session — the server
// has no cookie or token endpoint. It lives in localStorage because it has to outlive the tab; the
// Settings screen says so plainly rather than pretending otherwise.

const Api = (() => {
  'use strict';

  const BASE       = '/api/tools/sms-bridge';
  const SESSION_KEY = 'nexlink.session';

  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }

  const onSignedOut = [];

  const get = () => session;
  const isAuthed = () => !!(session && session.api_key);
  const accountId = () => session && session.user && session.user.account_id;

  function save(next) {
    session = next;
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else      localStorage.removeItem(SESSION_KEY);
  }

  /** An HTTP error the UI can show as-is: the server's own message, with its code kept. */
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  async function request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      if (!isAuthed()) throw new ApiError('Not signed in', 'NO_SESSION', 401);
      headers['x-api-key'] = session.api_key;
    }

    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Cannot reach the server', 'NETWORK', 0);
    }

    let data = null;
    try { data = await res.json(); } catch { /* 204s and error pages */ }

    if (!res.ok) {
      // A revoked or expired key means the session is simply gone — suspension revokes keys too
      // (users.setStatus), so this is also how a suspended user finds out.
      if (res.status === 401 && auth) signOut({ silent: true });
      throw new ApiError((data && data.error) || `Request failed (${res.status})`,
        data && data.code, res.status);
    }
    return data;
  }

  // ── Session ───────────────────────────────────────────────────────────────

  async function login(username, password) {
    const label = `Web · ${browserLabel()}`;
    const out = await request('/auth/login', { method: 'POST', auth: false, body: { username, password, label } });
    save({ api_key: out.api_key, key_id: out.key_id, user: out.user, is_admin: out.user.role === 'admin' });
    // The role in the login response is authoritative for the UI, but /auth/me is what the server
    // itself uses to decide, so it settles the question.
    try { await refreshMe(); } catch { /* the session is already usable */ }
    return out;
  }

  const register = (username, password) =>
    request('/auth/register', { method: 'POST', auth: false, body: { username, password } });

  const changePassword = (username, password, new_password) =>
    request('/auth/change-password', { method: 'POST', auth: false, body: { username, password, new_password } });

  async function refreshMe() {
    const me = await request('/auth/me');
    save({ ...session, user: me.user || session.user, is_admin: !!me.is_admin });
    return me;
  }

  function signOut({ silent = false } = {}) {
    // The server has no "revoke my own key" route (DELETE /admin/keys/:id is admin-only), so the
    // honest description is that this browser forgets the key — it is not invalidated server-side.
    save(null);
    if (!silent) onSignedOut.forEach(fn => fn());
  }

  function browserLabel() {
    const ua = navigator.userAgent;
    const name = /Edg\//.test(ua)     ? 'Edge'
               : /OPR\//.test(ua)     ? 'Opera'
               : /Firefox\//.test(ua) ? 'Firefox'
               : /Chrome\//.test(ua)  ? 'Chrome'
               : /Safari\//.test(ua)  ? 'Safari'
               : 'Browser';
    const os = /Android/.test(ua) ? 'Android'
             : /iPhone|iPad/.test(ua) ? 'iOS'
             : /Windows/.test(ua) ? 'Windows'
             : /Mac OS X/.test(ua) ? 'macOS'
             : /Linux/.test(ua) ? 'Linux'
             : '';
    return os ? `${name} on ${os}` : name;
  }

  // ── Bridge ────────────────────────────────────────────────────────────────

  const health       = () => fetch('/health').then(r => r.json());
  const devices      = () => request('/devices');
  const removeDevice = id => request(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const setDefault   = id => request(`/devices/${encodeURIComponent(id)}/default`, { method: 'PUT' });
  const pairingCode  = () => request('/generate-code', { method: 'POST' });

  const send    = payload => request('/send', { method: 'POST', body: payload });
  const history = (limit = 200) => request(`/history?limit=${limit}`);
  const stats   = () => request('/stats');
  const incoming = () => request('/incoming');

  const clientKeys     = () => request('/client-keys');
  const registerClientKey = (public_key, label) => request('/client-key', { method: 'POST', body: { public_key, label } });
  const removeClientKey   = keyId => request(`/client-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });

  // ── Administration ────────────────────────────────────────────────────────

  const adminUsers  = status => request(`/admin/users${status ? `?status=${status}` : ''}`);
  const setUserStatus = (id, status) => request(`/admin/users/${id}/status`, { method: 'POST', body: { status } });
  const adminAccounts = () => request('/admin/accounts');
  const accountKeys   = id => request(`/admin/accounts/${id}/keys`);
  const mintKey       = (id, label) => request(`/admin/accounts/${id}/keys`, { method: 'POST', body: { label } });
  const revokeKey     = keyId => request(`/admin/keys/${keyId}`, { method: 'DELETE' });

  return {
    ApiError, request, get, isAuthed, accountId, browserLabel,
    login, register, changePassword, refreshMe, signOut,
    onSignedOut: fn => onSignedOut.push(fn),
    health, devices, removeDevice, setDefault, pairingCode,
    send, history, stats, incoming,
    clientKeys, registerClientKey, removeClientKey,
    adminUsers, setUserStatus, adminAccounts, accountKeys, mintKey, revokeKey,
  };
})();
