'use strict';
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const CURVE  = 'P-256';
const ALG    = 'aes-256-gcm';
const IV_LEN = 12;
const INFO   = Buffer.from('sms-bridge-v1');
const SALT   = Buffer.alloc(32);
const KEYS_DIR = path.join(__dirname, '..', '..', '.keys');

function loadOrCreateServerKeys() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const keyFile = path.join(KEYS_DIR, 'server.pem');
  if (fs.existsSync(keyFile)) {
    const pem = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return { privateKey: crypto.createPrivateKey(pem.privateKey),
             publicKey:  crypto.createPublicKey(pem.publicKey),
             publicKeyB64: pem.publicKeyB64 };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: CURVE,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const publicKeyB64 = Buffer.from(
    crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  ).toString('base64');
  fs.writeFileSync(keyFile, JSON.stringify({ privateKey, publicKey, publicKeyB64 }), { mode: 0o600 });
  console.log('[crypto] Generated new server key pair → .keys/server.pem');
  return { privateKey: crypto.createPrivateKey(privateKey),
           publicKey:  crypto.createPublicKey(publicKey), publicKeyB64 };
}

function deriveKey(privateKey, publicKey) {
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  return Buffer.from(crypto.hkdfSync('sha256', shared, SALT, INFO, 32));
}

function encrypt(plaintext, recipientPublicKeyB64) {
  const recipientPub = crypto.createPublicKey({ key: Buffer.from(recipientPublicKeyB64, 'base64'), format: 'der', type: 'spki' });
  const ephemeral    = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const aesKey       = deriveKey(ephemeral.privateKey, recipientPub);
  const iv           = crypto.randomBytes(IV_LEN);
  const cipher       = crypto.createCipheriv(ALG, aesKey, iv);
  cipher.setAAD(INFO);
  const ct  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const epk = Buffer.from(ephemeral.publicKey.export({ type: 'spki', format: 'der' })).toString('base64');
  return { v:1, epk, iv:iv.toString('base64'), tag:tag.toString('base64'), ct:ct.toString('base64') };
}

function decrypt(envelope, recipientPrivateKey) {
  if (envelope.v !== 1) throw new Error('Unknown envelope version');
  const ephemeralPub = crypto.createPublicKey({ key: Buffer.from(envelope.epk, 'base64'), format: 'der', type: 'spki' });
  const aesKey       = deriveKey(recipientPrivateKey, ephemeralPub);
  const decipher     = crypto.createDecipheriv(ALG, aesKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(INFO);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()]).toString('utf8');
}

function decryptWithServerKey(envelope, serverKeys) {
  return decrypt(typeof envelope === 'string' ? JSON.parse(envelope) : envelope, serverKeys.privateKey);
}

module.exports = { loadOrCreateServerKeys, encrypt, decrypt, decryptWithServerKey };
