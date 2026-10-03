package com.j.uno.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.j.uno.model.UnoJson
import com.j.uno.model.UserDto

interface SessionStore {
    fun saveSession(user: UserDto, accessToken: String, refreshToken: String)
    fun updateAccessToken(accessToken: String)
    fun getAccessToken(): String?
    fun getRefreshToken(): String?
    fun getUser(): UserDto?
    fun clear()
    fun isLoggedIn(): Boolean = !getAccessToken().isNullOrBlank()
}

class EncryptedSessionStore(context: Context) : SessionStore {
    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "uno_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (_: Throwable) {
        // Fallback for JVM unit tests or legacy hardware lacking hardware keystore
        context.getSharedPreferences("uno_fallback_prefs", Context.MODE_PRIVATE)
    }

    private var inMemoryAccessToken: String? = prefs.getString(KEY_ACCESS_TOKEN, null)

    override fun saveSession(user: UserDto, accessToken: String, refreshToken: String) {
        inMemoryAccessToken = accessToken
        val userJson = UnoJson.encodeToString(UserDto.serializer(), user)
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putString(KEY_USER, userJson)
            .apply()
    }

    override fun updateAccessToken(accessToken: String) {
        inMemoryAccessToken = accessToken
        prefs.edit().putString(KEY_ACCESS_TOKEN, accessToken).apply()
    }

    override fun getAccessToken(): String? = inMemoryAccessToken

    override fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)

    override fun getUser(): UserDto? {
        val json = prefs.getString(KEY_USER, null) ?: return null
        return try {
            UnoJson.decodeFromString(UserDto.serializer(), json)
        } catch (_: Exception) {
            null
        }
    }

    override fun clear() {
        inMemoryAccessToken = null
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_USER = "user_json"
    }
}

class InMemorySessionStore : SessionStore {
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var user: UserDto? = null

    override fun saveSession(user: UserDto, accessToken: String, refreshToken: String) {
        this.user = user
        this.accessToken = accessToken
        this.refreshToken = refreshToken
    }

    override fun updateAccessToken(accessToken: String) {
        this.accessToken = accessToken
    }

    override fun getAccessToken(): String? = accessToken
    override fun getRefreshToken(): String? = refreshToken
    override fun getUser(): UserDto? = user

    override fun clear() {
        accessToken = null
        refreshToken = null
        user = null
    }
}
