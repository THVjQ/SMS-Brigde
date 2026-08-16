// js/store.js — everything this browser has to remember, in IndexedDB.
//
// Three of these stores exist because of a deliberate property of the server, not as a cache:
//
//   outbox  The server never returns the body of a sent message. `messages.COLUMNS` is
//           id,phone,status,… with no `message` — the text was encrypted to the *phone's* public
//           key on the way in, so nothing but that phone can read it back. If the browser wants to
//           show what it sent, the browser has to keep it.
//   inbox   Inbound is encrypted to this browser's key. Decryption costs an ECDH per message, so
//           each row is opened once and kept.
//   keys    The identity keypair itself. The private key is a non-extractable CryptoKey, which
//           IndexedDB stores as an opaque handle — usable for decryption, never readable as bytes.
//
// Everything is scoped by account id, so signing into a second account on the same machine cannot
// surface the first one's messages.

const Store = (() => {
  'use strict';

  const DB_NAME = 'sos-messenger';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('keys'))   db.createObjectStore('keys',   { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta'))   db.createObjectStore('meta',   { keyPath: 'k' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'uid' }).createIndex('account', 'account');
        if (!db.objectStoreNames.contains('inbox'))  db.createObjectStore('inbox',  { keyPath: 'uid' }).createIndex('account', 'account');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    return dbPromise;
  }

  /** Runs `fn` against one store and settles when the whole transaction commits, not when the
   *  request fires — a resolved write here means the data is actually durable. */
  async function tx(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      fn(t.objectStore(storeName));
      t.oncomplete = () => resolve(true);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error);
    });
  }

  const asList = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });

  // ── Identity keypair ──────────────────────────────────────────────────────

  const keyRecordId = accountId => `client:${accountId}`;

  async function getKeyPair(accountId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('keys').objectStore('keys').get(keyRecordId(accountId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  function putKeyPair(accountId, record) {
    return tx('keys', 'readwrite', s => s.put({ ...record, id: keyRecordId(accountId) }));
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /** uid namespaces the server's row id by account, so two accounts' id 7 cannot collide. */
  const uidFor = (account, kind, id) => `${account}:${kind}:${id}`;

  function putOutbound(account, { id, phone, text, at, status, deviceId }) {
    return tx('outbox', 'readwrite', s => s.put({
      uid: uidFor(account, 'out', id), account, id, phone, text, at, status, deviceId,
    }));
  }

  /** Status is the one field the server owns; /history is polled and the local row follows it. */
  async function setOutboundStatus(account, id, status) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const store = db.transaction('outbox', 'readwrite').objectStore('outbox');
      const get   = store.get(uidFor(account, 'out', id));
      get.onsuccess = () => {
        const row = get.result;
        if (!row || row.status === status) return resolve(false);
        row.status = status;
        store.put(row);
        resolve(true);
      };
      get.onerror = () => reject(get.error);
    });
  }

  function putInbound(account, { id, sender, text, at, e2e, readable }) {
    return tx('inbox', 'readwrite', s => s.put({
      uid: uidFor(account, 'in', id), account, id, sender, text, at, e2e, readable,
    }));
  }

  async function listOutbound(account) {
    const db = await open();
    return asList(db.transaction('outbox').objectStore('outbox').index('account').getAll(account));
  }

  async function listInbound(account) {
    const db = await open();
    return asList(db.transaction('inbox').objectStore('inbox').index('account').getAll(account));
  }

  async function knownInboundIds(account) {
    return new Set((await listInbound(account)).map(r => r.id));
  }

  // ── Small key/value state ────────────────────────────────────────────────

  async function meta(k, fallback = null) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('meta').objectStore('meta').get(k);
      req.onsuccess = () => resolve(req.result ? req.result.v : fallback);
      req.onerror   = () => reject(req.error);
    });
  }

  const setMeta = (k, v) => tx('meta', 'readwrite', s => s.put({ k, v }));

  /** Per-thread read marks: the newest inbound timestamp the user has actually looked at. */
  const readMarks   = account => meta(`read:${account}`, {});
  const setReadMark = async (account, threadKey, at) => {
    const marks = await readMarks(account);
    if (!marks[threadKey] || marks[threadKey] < at) {
      marks[threadKey] = at;
      await setMeta(`read:${account}`, marks);
    }
  };

  /** Wipes one account's local mirror — used when signing out. */
  async function clearAccount(account) {
    for (const name of ['outbox', 'inbox']) {
      const rows = await (name === 'outbox' ? listOutbound(account) : listInbound(account));
      await tx(name, 'readwrite', s => rows.forEach(r => s.delete(r.uid)));
    }
    await tx('keys', 'readwrite', s => s.delete(keyRecordId(account)));
    await tx('meta', 'readwrite', s => s.delete(`read:${account}`));
  }

  return {
    getKeyPair, putKeyPair,
    putOutbound, setOutboundStatus, putInbound,
    listOutbound, listInbound, knownInboundIds,
    meta, setMeta, readMarks, setReadMark, clearAccount,
  };
})();
