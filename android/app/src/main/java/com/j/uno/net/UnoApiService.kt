package com.j.uno.net

import com.j.uno.model.AuthResponse
import com.j.uno.model.CreateRoomRequest
import com.j.uno.model.ErrorResponse
import com.j.uno.model.GuestRequest
import com.j.uno.model.MyRoomsResponse
import com.j.uno.model.RefreshRequest
import com.j.uno.model.RoomResponse
import com.j.uno.model.RoomView
import com.j.uno.model.UnoJson
import com.j.uno.model.UserDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

class UnoApiException(val code: String, val httpStatus: Int, message: String = code) : IOException("[$httpStatus] $message")

class UnoApiService(
    private val baseUrl: String = "http://10.0.2.2:8787",
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun createGuest(displayName: String): Result<AuthResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val reqBody = UnoJson.encodeToString(GuestRequest.serializer(), GuestRequest(displayName))
                .toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/auth/guest")
                .post(reqBody)
                .build()
            executeAndParse(request, AuthResponse.serializer())
        }
    }

    suspend fun refresh(refreshToken: String): Result<AuthResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val reqBody = UnoJson.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
                .toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/auth/refresh")
                .post(reqBody)
                .build()
            executeAndParse(request, AuthResponse.serializer())
        }
    }

    suspend fun logout(refreshToken: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val reqBody = UnoJson.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
                .toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/auth/logout")
                .post(reqBody)
                .build()
            executeEmpty(request)
        }
    }

    suspend fun getMe(accessToken: String): Result<UserDto> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/me")
                .header("Authorization", "Bearer $accessToken")
                .get()
                .build()
            executeAndParse(request, UserDto.serializer())
        }
    }

    suspend fun createRoom(accessToken: String, opts: CreateRoomRequest = CreateRoomRequest()): Result<RoomView> = withContext(Dispatchers.IO) {
        runCatching {
            val reqBody = UnoJson.encodeToString(CreateRoomRequest.serializer(), opts)
                .toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/room")
                .header("Authorization", "Bearer $accessToken")
                .post(reqBody)
                .build()
            executeAndParse(request, RoomResponse.serializer()).room
        }
    }

    suspend fun quickplay(accessToken: String): Result<RoomView> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/room/quickplay")
                .header("Authorization", "Bearer $accessToken")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            executeAndParse(request, RoomResponse.serializer()).room
        }
    }

    suspend fun joinRoom(accessToken: String, code: String): Result<RoomView> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/room/$code/join")
                .header("Authorization", "Bearer $accessToken")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            executeAndParse(request, RoomResponse.serializer()).room
        }
    }

    suspend fun leaveRoom(accessToken: String, code: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/room/$code/leave")
                .header("Authorization", "Bearer $accessToken")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            executeEmpty(request)
        }
    }

    suspend fun startRoom(accessToken: String, code: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/room/$code/start")
                .header("Authorization", "Bearer $accessToken")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            executeEmpty(request)
        }
    }

    suspend fun getRoom(accessToken: String, code: String): Result<RoomView> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/room/$code")
                .header("Authorization", "Bearer $accessToken")
                .get()
                .build()
            executeAndParse(request, RoomResponse.serializer()).room
        }
    }

    suspend fun getMyRooms(accessToken: String): Result<List<RoomView>> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/my/rooms")
                .header("Authorization", "Bearer $accessToken")
                .get()
                .build()
            executeAndParse(request, MyRoomsResponse.serializer()).rooms
        }
    }

    suspend fun blockUser(accessToken: String, targetUserId: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val payload = UnoJson.encodeToString(com.j.uno.model.BlockRequest.serializer(), com.j.uno.model.BlockRequest(targetUserId))
            val request = Request.Builder()
                .url("$baseUrl/block")
                .header("Authorization", "Bearer $accessToken")
                .post(payload.toRequestBody(jsonMediaType))
                .build()
            executeEmpty(request)
        }
    }

    suspend fun unblockUser(accessToken: String, targetUserId: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/block/$targetUserId")
                .header("Authorization", "Bearer $accessToken")
                .delete()
                .build()
            executeEmpty(request)
        }
    }

    suspend fun getBlockedUsers(accessToken: String): Result<List<String>> = withContext(Dispatchers.IO) {
        runCatching {
            val request = Request.Builder()
                .url("$baseUrl/blocks")
                .header("Authorization", "Bearer $accessToken")
                .get()
                .build()
            executeAndParse(request, com.j.uno.model.BlockListResponse.serializer()).blockedUserIds
        }
    }

    suspend fun reportUser(
        accessToken: String,
        targetUserId: String,
        category: String,
        roomCode: String? = null,
        messageId: String? = null,
        reason: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val reqBody = com.j.uno.model.ReportRequest(
                targetUserId = targetUserId,
                category = category,
                roomCode = roomCode,
                messageId = messageId,
                reason = reason
            )
            val payload = UnoJson.encodeToString(com.j.uno.model.ReportRequest.serializer(), reqBody)
            val request = Request.Builder()
                .url("$baseUrl/report")
                .header("Authorization", "Bearer $accessToken")
                .post(payload.toRequestBody(jsonMediaType))
                .build()
            executeAndParse(request, com.j.uno.model.ReportResponse.serializer()).reportId
        }
    }

    private fun <T> executeAndParse(request: Request, serializer: kotlinx.serialization.KSerializer<T>): T {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw parseError(response, body)
            }
            return UnoJson.decodeFromString(serializer, body)
        }
    }

    private fun executeEmpty(request: Request) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw parseError(response, body)
            }
        }
    }

    private fun parseError(response: Response, body: String): UnoApiException {
        return try {
            val err = UnoJson.decodeFromString(ErrorResponse.serializer(), body)
            UnoApiException(code = err.error.code, httpStatus = response.code)
        } catch (_: Exception) {
            UnoApiException(code = "UNKNOWN_ERROR", httpStatus = response.code, message = body.ifBlank { response.message })
        }
    }
}
