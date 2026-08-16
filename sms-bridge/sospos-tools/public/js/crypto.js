// js/crypto.js — the browser half of the bridge's ECIES.
//
// Byte-for-byte the same scheme as tools/sms-bridge/crypto.js and the Tampermonkey popup:
// ECDH P-256 → HKDF-SHA256(salt = 32 zero bytes, info = "sms-bridge-v1") → AES-256-GCM with the
// same info string as additional authenticated data. Any drift here produces envelopes the phone
// silently fails to open, so none of these constants may be "tidied up".
//
// The one thing that differs from Node: WebCrypto wants ciphertext‖tag as a single buffer, while
// Node keeps the GCM tag in its own field. Envelopes are stored in Node's shape, so we split on the
// way out and join on the way in.

const NexCrypto = (() => {
  'use strict';

  const INFO  = new TextEncoder().encode('sms-bridge-v1');
  const SALT  = new Uint8Array(32);
  const CURVE = { name: 'ECDH', namedCurve: 'P-256' };

  const b64enc = bytes => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };
  const b64dec = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  const importPublic = b64 =>
    crypto.subtle.importKey('spki', b64dec(b64).buffer, CURVE, true, []);

  const exportPublic = async key =>
    b64enc(new Uint8Array(await crypto.subtle.exportKey('spki', key)));

  /**
   * ECDH → HKDF → AES-GCM. `usages` is split out because a key derived for 'encrypt' cannot
   * decrypt: the same derivation has to run twice with different usages.
   */
  async function deriveAes(privateKey, publicKey, usages) {
    const shared = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: publicKey }, privateKey, { name: 'HKDF' }, false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: INFO },
      shared, { name: 'AES-GCM', length: 256 }, false, usages,
    );
  }

  /**
   * A fresh ephemeral keypair per message — that is what makes this forward-secret, and why the
   * recipient can decrypt without ever having spoken to us first.
   */
  async function encrypt(plaintext, recipientPublicKeyB64) {
    const recipient = await importPublic(recipientPublicKeyB64);
    const ephemeral = await crypto.subtle.generateKey(CURVE, true, ['deriveKey']);
    const aesKey    = await deriveAes(ephemeral.privateKey, recipient, ['encrypt']);
    const iv        = crypto.getRandomValues(new Uint8Array(12));

    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: INFO },
      aesKey, new TextEncoder().encode(plaintext),
    ));

    // WebCrypto appends the 16-byte tag; Node expects it in its own field.
    const cut = sealed.length - 16;
    return {
      v: 1,
      epk: await exportPublic(ephemeral.publicKey),
      iv:  b64enc(iv),
      tag: b64enc(sealed.slice(cut)),
      ct:  b64enc(sealed.slice(0, cut)),
    };
  }

  async function decrypt(envelope, privateKey) {
    if (!envelope || envelope.v !== 1) throw new Error('Unknown envelope version');
    const ephemeralPub = await importPublic(envelope.epk);
    const aesKey       = await deriveAes(privateKey, ephemeralPub, ['decrypt']);

    const ct   = b64dec(envelope.ct);
    const tag  = b64dec(envelope.tag);
    const both = new Uint8Array(ct.length + tag.length);
    both.set(ct, 0);
    both.set(tag, ct.length);

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64dec(envelope.iv), additionalData: INFO }, aesKey, both,
    );
    return new TextDecoder().decode(plain);
  }

  /**
   * This browser's identity. The private key is generated non-extractable, so it can be used to
   * decrypt but never read back out of the browser — not by this code, not by anything injected
   * into the page. (For an EC pair the extractable flag applies to the private half only; the
   * public key stays exportable, which is what registration needs.)
   */
  const generateKeyPair = () => crypto.subtle.generateKey(CURVE, false, ['deriveKey']);

  /** Matches clientKeys.keyIdFor: first 8 bytes of SHA-256 over the DER, hex. */
  async function keyIdFor(publicKeyB64) {
    const digest = await crypto.subtle.digest('SHA-256', b64dec(publicKeyB64));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  return { encrypt, decrypt, generateKeyPair, exportPublic, keyIdFor, b64enc, b64dec };
})();
