package com.sospos.messenger.crypto

// ─────────────────────────────────────────────────────────────────────────────
//  E2EEncryption.kt
//
//  Mirrors the server-side ECIES scheme exactly:
//    Key agreement : ECDH with P-256 (supported on all Android API 26+)
//    Key derivation: HKDF-SHA256
//    Symmetric enc : AES-256-GCM (12-byte IV, 16-byte GCM auth tag)
//
//  Wire format (JSON):
//  {
//    "v":   1,
//    "epk": "<base64 DER SPKI ephemeral public key>",
//    "iv":  "<base64 12 bytes>",
//    "tag": "<base64 16 bytes>",
//    "ct":  "<base64 ciphertext>"
//  }
// ─────────────────────────────────────────────────────────────────────────────

import android.util.Base64
import org.json.JSONObject
import java.security.*
import java.security.spec.*
import javax.crypto.*
import javax.crypto.spec.*

object E2EEncryption {

    private const val CURVE   = "EC"
    private const val CURVE_NAME = "secp256r1"   // = P-256
    private const val KA_ALG  = "ECDH"
    private const val ENC_ALG = "AES/GCM/NoPadding"
    private const val GCM_TAG = 128              // bits
    private const val IV_LEN  = 12               // bytes
    private val INFO  = "sms-bridge-v1".toByteArray()
    private val SALT  = ByteArray(32)            // all-zeros, matches server

    // ── Key generation ────────────────────────────────────────────────────────

    /** Generate a fresh P-256 key pair for this device. */
    fun generateKeyPair(): KeyPair {
        val kg = KeyPairGenerator.getInstance(CURVE)
        kg.initialize(ECGenParameterSpec(CURVE_NAME), SecureRandom())
        return kg.generateKeyPair()
    }

    /** Export a public key to base64-encoded DER SPKI (matches server format). */
    fun exportPublicKey(key: PublicKey): String =
        Base64.encodeToString(key.encoded, Base64.NO_WRAP)

    /** Import a base64-encoded DER SPKI public key. */
    fun importPublicKey(b64: String): PublicKey {
        val der   = Base64.decode(b64, Base64.NO_WRAP)
        val spec  = X509EncodedKeySpec(der)
        return KeyFactory.getInstance(CURVE).generatePublic(spec)
    }

    /** Export a private key to base64 PKCS#8. */
    fun exportPrivateKey(key: PrivateKey): String =
        Base64.encodeToString(key.encoded, Base64.NO_WRAP)

    /** Import a base64 PKCS#8 private key. */
    fun importPrivateKey(b64: String): PrivateKey {
        val der  = Base64.decode(b64, Base64.NO_WRAP)
        val spec = PKCS8EncodedKeySpec(der)
        return KeyFactory.getInstance(CURVE).generatePrivate(spec)
    }

    // ── Core ECIES ────────────────────────────────────────────────────────────

    /**
     * Encrypt [plaintext] for the owner of [recipientPublicKeyB64].
     * Returns a JSON string representing the envelope.
     */
    fun encrypt(plaintext: String, recipientPublicKeyB64: String): String {
        val recipientPub = importPublicKey(recipientPublicKeyB64)

        // Fresh ephemeral key pair for this message
        val ephemeral = generateKeyPair()

        // ECDH → shared secret → AES key
        val aesKey = deriveKey(ephemeral.private, recipientPub)

        // AES-256-GCM encrypt
        val iv     = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(ENC_ALG)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(GCM_TAG, iv))
        cipher.updateAAD(INFO)
        val cipherWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // GCM appends the 16-byte tag to the ciphertext; split them
        val ct  = cipherWithTag.copyOf(cipherWithTag.size - 16)
        val tag = cipherWithTag.copyOfRange(cipherWithTag.size - 16, cipherWithTag.size)

        return JSONObject().apply {
            put("v",   1)
            put("epk", exportPublicKey(ephemeral.public))
            put("iv",  Base64.encodeToString(iv,  Base64.NO_WRAP))
            put("tag", Base64.encodeToString(tag, Base64.NO_WRAP))
            put("ct",  Base64.encodeToString(ct,  Base64.NO_WRAP))
        }.toString()
    }

    /**
     * Decrypt an envelope JSON string using [recipientPrivateKeyB64].
     * Throws on auth failure or malformed input.
     */
    fun decrypt(envelopeJson: String, recipientPrivateKeyB64: String): String {
        val env            = JSONObject(envelopeJson)
        val version        = env.getInt("v")
        require(version == 1) { "Unknown envelope version: $version" }

        val ephemeralPub   = importPublicKey(env.getString("epk"))
        val recipientPriv  = importPrivateKey(recipientPrivateKeyB64)

        val aesKey = deriveKey(recipientPriv, ephemeralPub)

        val iv  = Base64.decode(env.getString("iv"),  Base64.NO_WRAP)
        val tag = Base64.decode(env.getString("tag"), Base64.NO_WRAP)
        val ct  = Base64.decode(env.getString("ct"),  Base64.NO_WRAP)

        // Java GCM expects ciphertext + tag concatenated
        val ctWithTag = ct + tag

        val cipher = Cipher.getInstance(ENC_ALG)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(GCM_TAG, iv))
        cipher.updateAAD(INFO)
        return cipher.doFinal(ctWithTag).toString(Charsets.UTF_8)
    }

    // ── ECDH + HKDF ──────────────────────────────────────────────────────────

    private fun deriveKey(priv: PrivateKey, pub: PublicKey): ByteArray {
        val ka = KeyAgreement.getInstance(KA_ALG)
        ka.init(priv)
        ka.doPhase(pub, true)
        val shared = ka.generateSecret()
        return hkdf(shared, SALT, INFO, 32)
    }

    /**
     * HKDF-SHA256 (RFC 5869) — pure Java implementation.
     * Extract then expand to [length] bytes.
     */
    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")

        // Extract
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = mac.doFinal(ikm)

        // Expand
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        val result = ByteArray(length)
        var t = ByteArray(0)
        var offset = 0
        var counter = 1
        while (offset < length) {
            mac.update(t)
            mac.update(info)
            mac.update(counter.toByte())
            t = mac.doFinal()
            val copy = minOf(t.size, length - offset)
            t.copyInto(result, offset, 0, copy)
            offset += copy
            counter++
        }
        return result
    }
}
