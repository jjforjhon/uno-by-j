package com.j.uno.net

import com.j.uno.model.CardColor
import com.j.uno.model.CardKind
import com.j.uno.model.CreateRoomRequest
import com.j.uno.model.RoomMemberView
import com.j.uno.model.RoomSettings
import com.j.uno.model.RoomView
import com.j.uno.model.UnoCard
import com.j.uno.model.UserDto
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UnoApiServiceTest {
    private lateinit var server: MockWebServer
    private lateinit var api: UnoApiService

    @Before
    fun setup() {
        server = MockWebServer()
        server.start()
        api = UnoApiService(baseUrl = server.url("/").toString().removeSuffix("/"))
    }

    @After
    fun teardown() {
        server.shutdown()
    }

    @Test
    fun testCreateGuestSuccess() = runTest {
        val json = """
            {
              "user": {
                "id": "u_test1",
                "handle": "guest_abc",
                "displayName": "Player One",
                "avatarId": 2
              },
              "accessToken": "access.jwt.123",
              "refreshToken": "refresh.opaque.456"
            }
        """.trimIndent()

        server.enqueue(MockResponse().setResponseCode(201).setBody(json))

        val result = api.createGuest("Player One")
        assertTrue(result.isSuccess)
        val auth = result.getOrThrow()
        assertEquals("u_test1", auth.user.id)
        assertEquals("Player One", auth.user.displayName)
        assertEquals("access.jwt.123", auth.accessToken)

        val recorded = server.takeRequest()
        assertEquals("/auth/guest", recorded.path)
        assertEquals("POST", recorded.method)
        assertTrue(recorded.body.readUtf8().contains("\"displayName\":\"Player One\""))
    }

    @Test
    fun testCreateRoomSuccess() = runTest {
        val json = """
            {
              "room": {
                "code": "A1B2C3",
                "hostUserId": "u_host",
                "isPublic": false,
                "status": "WAITING",
                "maxPlayers": 4,
                "settings": {
                  "matchMode": false,
                  "stacking": false,
                  "turnTimeoutS": 30
                },
                "members": [
                  {
                    "userId": "u_host",
                    "handle": "host_h",
                    "displayName": "Host",
                    "avatarId": 0,
                    "role": "HOST",
                    "isHost": true
                  }
                ]
              }
            }
        """.trimIndent()

        server.enqueue(MockResponse().setResponseCode(201).setBody(json))

        val result = api.createRoom("token_123", CreateRoomRequest(isPublic = false, maxPlayers = 4))
        assertTrue(result.isSuccess)
        val room = result.getOrThrow()
        assertEquals("A1B2C3", room.code)
        assertEquals("u_host", room.hostUserId)
        assertEquals(1, room.members.size)

        val recorded = server.takeRequest()
        assertEquals("/room", recorded.path)
        assertEquals("Bearer token_123", recorded.getHeader("Authorization"))
    }

    @Test
    fun testStartRoomSuccess() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))

        val result = api.startRoom("token_host", "A1B2C3")
        assertTrue(result.isSuccess)

        val recorded = server.takeRequest()
        assertEquals("/room/A1B2C3/start", recorded.path)
        assertEquals("POST", recorded.method)
        assertEquals("Bearer token_host", recorded.getHeader("Authorization"))
    }

    @Test
    fun testErrorHandlingParsesStableCode() = runTest {
        val errorJson = """
            {
              "error": {
                "code": "ROOM_FULL"
              }
            }
        """.trimIndent()

        server.enqueue(MockResponse().setResponseCode(409).setBody(errorJson))

        val result = api.joinRoom("token_guest", "A1B2C3")
        assertTrue(result.isFailure)
        val ex = result.exceptionOrNull()
        assertTrue(ex is UnoApiException)
        val apiEx = ex as UnoApiException
        assertEquals("ROOM_FULL", apiEx.code)
        assertEquals(409, apiEx.httpStatus)
    }

    @Test
    fun testBlockAndUnblockUser() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))

        val blockResult = api.blockUser("token_1", "u_bad_guy")
        assertTrue(blockResult.isSuccess)
        val blockReq = server.takeRequest()
        assertEquals("/block", blockReq.path)
        assertEquals("POST", blockReq.method)
        assertTrue(blockReq.body.readUtf8().contains("\"targetUserId\":\"u_bad_guy\""))

        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))
        val unblockResult = api.unblockUser("token_1", "u_bad_guy")
        assertTrue(unblockResult.isSuccess)
        val unblockReq = server.takeRequest()
        assertEquals("/block/u_bad_guy", unblockReq.path)
        assertEquals("DELETE", unblockReq.method)
    }

    @Test
    fun testGetBlockedUsers() = runTest {
        val json = """
            {
              "blockedUserIds": ["u_bad_1", "u_bad_2"]
            }
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(200).setBody(json))

        val result = api.getBlockedUsers("token_1")
        assertTrue(result.isSuccess)
        assertEquals(listOf("u_bad_1", "u_bad_2"), result.getOrThrow())

        val recorded = server.takeRequest()
        assertEquals("/blocks", recorded.path)
        assertEquals("GET", recorded.method)
    }

    @Test
    fun testReportUser() = runTest {
        val json = """
            {
              "ok": true,
              "reportId": "rep_999"
            }
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(201).setBody(json))

        val result = api.reportUser(
            accessToken = "token_1",
            targetUserId = "u_bad_guy",
            category = "HARASSMENT",
            roomCode = "ROOM01",
            messageId = "msg_123",
            reason = "Rude behavior"
        )
        assertTrue(result.isSuccess)
        assertEquals("rep_999", result.getOrThrow())

        val recorded = server.takeRequest()
        assertEquals("/report", recorded.path)
        assertEquals("POST", recorded.method)
        val body = recorded.body.readUtf8()
        assertTrue(body.contains("\"targetUserId\":\"u_bad_guy\""))
        assertTrue(body.contains("\"category\":\"HARASSMENT\""))
        assertTrue(body.contains("\"roomCode\":\"ROOM01\""))
    }

    @Test
    fun testSessionStoreFlow() {
        val store = InMemorySessionStore()
        assertEquals(false, store.isLoggedIn())

        val user = UserDto("u_1", "handle_1", "Name", 3)
        store.saveSession(user, "acc_1", "ref_1")
        assertEquals(true, store.isLoggedIn())
        assertEquals("acc_1", store.getAccessToken())
        assertEquals("ref_1", store.getRefreshToken())
        assertEquals("Name", store.getUser()?.displayName)

        store.updateAccessToken("acc_2")
        assertEquals("acc_2", store.getAccessToken())

        store.clear()
        assertEquals(false, store.isLoggedIn())
        assertEquals(null, store.getAccessToken())
        assertEquals(null, store.getUser())
    }
}
