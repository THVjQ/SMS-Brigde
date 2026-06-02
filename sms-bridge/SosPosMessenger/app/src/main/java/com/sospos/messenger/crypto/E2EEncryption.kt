package com.sospos.messenger.crypto

import android.util.Base64
import org.json.JSONObject
import java.security.*
import java.security.spec.*
import javax.crypto.*
import javax.crypto.spec.*

object E2EEncryption {
    private const val CURVE = "EC"; private const val CURVE_NAME = "secp256r1"
    private const val KA_ALG = "ECDH"; private const val ENC_ALG = "AES/GCM/NoPadding"
    private const val GCM_TAG = 128; private const val IV_LEN = 12
    private val INFO = "sms-bridge-v1".toByteArray(); private val SALT = ByteArray(32)

    fun generateKeyPair(): KeyPair {
        val kg = KeyPairGenerator.getInstance(CURVE)
        kg.initialize(ECGenParameterSpec(CURVE_NAME), SecureRandom()); return kg.generateKeyPair()
    }
    fun exportPublicKey(key: PublicKey): String = Base64.encodeToString(key.encoded, Base64.NO_WRAP)
    fun importPublicKey(b64: String): PublicKey = KeyFactory.getInstance(CURVE).generatePublic(X509EncodedKeySpec(Base64.decode(b64, Base64.NO_WRAP)))
    fun exportPrivateKey(key: PrivateKey): String = Base64.encodeToString(key.encoded, Base64.NO_WRAP)
    fun importPrivateKey(b64: String): PrivateKey = KeyFactory.getInstance(CURVE).generatePrivate(PKCS8EncodedKeySpec(Base64.decode(b64, Base64.NO_WRAP)))

    fun encrypt(plaintext: String, recipientPublicKeyB64: String): String {
        val recipientPub = importPublicKey(recipientPublicKeyB64)
        val ephemeral = generateKeyPair()
        val aesKey = deriveKey(ephemeral.private, recipientPub)
        val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(ENC_ALG)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(GCM_TAG, iv))
        cipher.updateAAD(INFO)
        val cipherWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val ct = cipherWithTag.copyOf(cipherWithTag.size - 16)
        val tag = cipherWithTag.copyOfRange(cipherWithTag.size - 16, cipherWithTag.size)
        return JSONObject().apply {
            put("v", 1); put("epk", exportPublicKey(ephemeral.public))
            put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            put("tag", Base64.encodeToString(tag, Base64.NO_WRAP))
            put("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
        }.toString()
    }

    fun decrypt(envelopeJson: String, recipientPrivateKeyB64: String): String {
        val env = JSONObject(envelopeJson)
        require(env.getInt("v") == 1) { "Unknown envelope version" }
        val ephemeralPub = importPublicKey(env.getString("epk"))
        val aesKey = deriveKey(importPrivateKey(recipientPrivateKeyB64), ephemeralPub)
        val iv = Base64.decode(env.getString("iv"), Base64.NO_WRAP)
        val tag = Base64.decode(env.getString("tag"), Base64.NO_WRAP)
        val ct = Base64.decode(env.getString("ct"), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(ENC_ALG)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(GCM_TAG, iv))
        cipher.updateAAD(INFO)
        return cipher.doFinal(ct + tag).toString(Charsets.UTF_8)
    }

    private fun deriveKey(priv: PrivateKey, pub: PublicKey): ByteArray {
        val ka = KeyAgreement.getInstance(KA_ALG); ka.init(priv); ka.doPhase(pub, true)
        return hkdf(ka.generateSecret(), SALT, INFO, 32)
    }

    private fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256")); val prk = mac.doFinal(ikm)
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        val result = ByteArray(length); var t = ByteArray(0); var offset = 0; var counter = 1
        while (offset < length) {
            mac.update(t); mac.update(info); mac.update(counter.toByte()); t = mac.doFinal()
            val copy = minOf(t.size, length - offset); t.copyInto(result, offset, 0, copy)
            offset += copy; counter++
        }
        return result
    }
}
