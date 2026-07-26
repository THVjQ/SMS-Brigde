// The ECIES v1 contract, checked across implementations.
//
// The scheme has three implementations — node:crypto here, JCA in NexLink, WebCrypto in the
// Tampermonkey script — and they must stay byte-compatible or messages silently fail to decrypt at
// the far end, which is exactly the class of failure this whole roadmap exists to remove.
//
// The block below mirrors the userscript's crypto verbatim. If crypto.js changes and this test
// starts failing, the userscript and NexLink need the same change, not this file.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const E2E = require('../tools/sms-bridge/crypto');
const { keyIdFor } = require('../tools/sms-bridge/clientKeys');
const { generateDeviceKey } = require('./helpers');

const subtle = webcrypto.subtle;
const E2E_INFO = new TextEncoder().encode('sms-bridge-v1');
const E2E_SALT = new Uint8Array(32);

const b64enc = buf => Buffer.from(new Uint8Array(buf)).toString('base64');
const b64dec = s   => new Uint8Array(Buffer.from(s, 'base64'));

// ── Mirror of the userscript ─────────────────────────────────────────────────

async function generateClientKeys() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
    publicB64:  b64enc(await subtle.exportKey('spki', pair.publicKey)),
  };
}

async function clientKeyId(publicB64) {
  const digest = await subtle.digest('SHA-256', b64dec(publicB64));
  return Array.from(new Uint8Array(digest).slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveAesKey(privateJwk, ephemeralSpkiB64) {
  const priv = await subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const epk  = await subtle.importKey('spki', b64dec(ephemeralSpkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256);

  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: E2E_SALT, info: E2E_INFO }, hkdfKey, 256);
  return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function encryptEnvelope(plaintext, recipientSpkiB64) {
  const recipient = await subtle.importKey('spki', b64dec(recipientSpkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

  const shared  = await subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const bits    = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: E2E_SALT, info: E2E_INFO }, hkdfKey, 256);
  const aesKey  = await subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);

  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: E2E_INFO, tagLength: 128 }, aesKey, new TextEncoder().encode(plaintext)));

  return {
    v: 1,
    epk: b64enc(await subtle.exportKey('spki', ephemeral.publicKey)),
    iv:  b64enc(iv),
    tag: b64enc(sealed.slice(sealed.length - 16)),
    ct:  b64enc(sealed.slice(0, sealed.length - 16)),
  };
}

async function decryptEnvelope(envelope, privateJwk) {
  if (!envelope || envelope.v !== 1) throw new Error('Unknown envelope version');
  const aesKey = await deriveAesKey(privateJwk, envelope.epk);
  const ct  = b64dec(envelope.ct);
  const tag = b64dec(envelope.tag);
  const buf = new Uint8Array(ct.length + tag.length);
  buf.set(ct); buf.set(tag, ct.length);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64dec(envelope.iv), additionalData: E2E_INFO, tagLength: 128 }, aesKey, buf);
  return new TextDecoder().decode(plain);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ECIES v1 cross-implementation contract', () => {
  test('WebCrypto opens what node:crypto sealed', async () => {
    const keys = await generateClientKeys();
    const plaintext = 'Hi, yes — I will collect it tomorrow afternoon.';
    const envelope = E2E.encrypt(plaintext, keys.publicB64);

    assert.equal(envelope.v, 1);
    assert.equal(b64dec(envelope.iv).length, 12, '12-byte IV');
    assert.equal(b64dec(envelope.tag).length, 16, '16-byte tag, kept separate from the ciphertext');

    assert.equal(await decryptEnvelope(envelope, keys.privateJwk), plaintext);
  });

  test('non-ASCII survives the round trip', async () => {
    const keys = await generateClientKeys();
    const plaintext = 'Réparé ✅ — 携帯電話の修理が完了しました';
    assert.equal(await decryptEnvelope(E2E.encrypt(plaintext, keys.publicB64), keys.privateJwk), plaintext);
  });

  test('a tampered envelope fails to authenticate', async () => {
    const keys = await generateClientKeys();
    const envelope = E2E.encrypt('original', keys.publicB64);
    const bytes = b64dec(envelope.ct);
    bytes[0] ^= 0xff;
    await assert.rejects(() => decryptEnvelope({ ...envelope, ct: b64enc(bytes) }, keys.privateJwk),
      'GCM must reject a modified ciphertext rather than return garbage');
  });

  test('another key does not open it', async () => {
    const mine = await generateClientKeys();
    const theirs = await generateClientKeys();
    await assert.rejects(() => decryptEnvelope(E2E.encrypt('private', mine.publicB64), theirs.privateJwk));
  });

  // The outbound direction. The userscript now seals messages itself rather than handing the server
  // plaintext to encrypt, so what a browser produces must open with the same code path the phone
  // uses. node:crypto stands in for the phone's JCA here — the two are already proven equivalent by
  // the tests above and by every outbound message that has ever been delivered.
  test('node:crypto opens what WebCrypto sealed', async () => {
    const phone = generateDeviceKey();
    const plaintext = 'Hi John, your iPhone 14 Pro (#A1234) is ready for collection.';
    const envelope = await encryptEnvelope(plaintext, phone.publicKeyB64);

    assert.equal(envelope.v, 1);
    assert.equal(b64dec(envelope.iv).length, 12);
    assert.equal(b64dec(envelope.tag).length, 16);
    assert.equal(E2E.decrypt(envelope, phone.privateKey), plaintext);
  });

  test('a browser-sealed message survives a full round trip', async () => {
    const phone = generateDeviceKey();
    const text = 'Réparé ✅ — pick up any time before 5pm';
    // Browser seals → (server relays verbatim) → phone opens.
    const relayed = JSON.parse(JSON.stringify(await encryptEnvelope(text, phone.publicKeyB64)));
    assert.equal(E2E.decrypt(relayed, phone.privateKey), text);
  });

  test('a browser-sealed message is not readable with the wrong key', async () => {
    const phone = generateDeviceKey();
    const other = generateDeviceKey();
    const envelope = await encryptEnvelope('private', phone.publicKeyB64);
    assert.throws(() => E2E.decrypt(envelope, other.privateKey));
  });

  test('both sides compute the same key id', async () => {
    const keys = await generateClientKeys();
    assert.equal(await clientKeyId(keys.publicB64), keyIdFor(keys.publicB64));
  });
});
