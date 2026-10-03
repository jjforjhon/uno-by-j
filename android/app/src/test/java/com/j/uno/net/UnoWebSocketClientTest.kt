package com.j.uno.net

import com.j.uno.model.CardColor
import com.j.uno.model.ClientEnvelope
import com.j.uno.model.UnoJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class UnoWebSocketClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: UnoWebSocketClient
    private val incomingClientMessages = LinkedBlockingQueue<String>()
    private var serverSideWs: WebSocket? = null

    @Before
    fun setup() {
        server = MockWebServer()
        server.start()

        val wsUrl = "ws://${server.hostName}:${server.port}"
        client = UnoWebSocketClient(
            wsBaseUrl = wsUrl,
            client = OkHttpClient.Builder().build(),
            scope = CoroutineScope(Dispatchers.IO)
        )
    }

    @After
    fun teardown() {
        client.disconnect()
        try {
            server.shutdown()
        } catch (_: Exception) {}
    }

    @Test
    fun testHelloHandshakeAndWelcomeTransition() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        val welcomeJson = """
                            {
                              "v": 1,
                              "type": "WELCOME",
                              "seq": 1,
                              "d": {
                                "you": {
                                  "userId": "user_abc",
                                  "seat": 0
                                },
                                "roomSeq": 1
                              }
                            }
                        """.trimIndent()
                        webSocket.send(welcomeJson)
                    }
                }
            })
        )

        client.connect("ROOM01", "jwt_token_123")

        val firstMsg = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(firstMsg)
        val helloEnv = UnoJson.decodeFromString(ClientEnvelope.serializer(), firstMsg!!)
        assertEquals("HELLO", helloEnv.type)

        // Wait for connected state
        val state = client.connectionState.first { it is WsConnectionState.Connected }
        val connected = state as WsConnectionState.Connected
        assertEquals("user_abc", connected.you.userId)
        assertEquals(0, connected.you.seat)
        assertEquals("ROOM01", connected.roomCode)

        client.disconnect()
    }

    @Test
    fun testSnapshotAndEventFlows() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        webSocket.send("""{"v":1,"type":"WELCOME","seq":1,"d":{"you":{"userId":"u_1","seat":0}}}""")
                        webSocket.send("""
                            {
                              "v": 1,
                              "type": "SNAPSHOT",
                              "seq": 1,
                              "d": {
                                "room": {
                                  "code": "ROOM02",
                                  "hostUserId": "u_1",
                                  "isPublic": false,
                                  "status": "WAITING",
                                  "maxPlayers": 4,
                                  "settings": {"matchMode":false,"stacking":false,"turnTimeoutS":30},
                                  "members": []
                                },
                                "game": null
                              }
                            }
                        """.trimIndent())
                        webSocket.send("""
                            {
                              "v": 1,
                              "type": "EVENT",
                              "seq": 2,
                              "d": {
                                "kind": "PLAYER_JOINED",
                                "userId": "u_2",
                                "displayName": "Player Two"
                              }
                            }
                        """.trimIndent())
                    }
                }
            })
        )

        client.connect("ROOM02", "jwt_token_456")

        val snap = client.snapshotFlow.first()
        assertEquals("ROOM02", snap.room.code)

        val ev = client.eventFlow.first()
        assertEquals("PLAYER_JOINED", ev.kind)
        assertEquals("u_2", ev.userId)
        assertEquals("Player Two", ev.displayName)

        client.disconnect()
    }

    @Test
    fun testGapDetectionTriggersSyncReq() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        // Send welcome with seq 1
                        webSocket.send("""{"v":1,"type":"WELCOME","seq":1,"d":{"you":{"userId":"u_1","seat":0}}}""")
                        // Intentionally skip to seq 5 (gap: 2, 3, 4 missing!)
                        webSocket.send("""{"v":1,"type":"EVENT","seq":5,"d":{"kind":"GAME_STARTED","playerCount":2}}""")
                    }
                }
            })
        )

        client.connect("ROOM03", "jwt_token_gap")

        // 1st message is HELLO
        val msg1 = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(msg1)
        assertEquals("HELLO", UnoJson.decodeFromString(ClientEnvelope.serializer(), msg1!!).type)

        // 2nd message should be SYNC_REQ triggered by seq 5 > lastSeq 1 + 1
        val msg2 = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(msg2)
        val syncEnv = UnoJson.decodeFromString(ClientEnvelope.serializer(), msg2!!)
        assertEquals("SYNC_REQ", syncEnv.type)

        client.disconnect()
    }

    @Test
    fun testActionDispatches() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                }
            })
        )

        client.connect("ROOM04", "jwt_token_act")
        // Discard HELLO
        incomingClientMessages.poll(3, TimeUnit.SECONDS)

        client.sendPlayCard("card_r_5", CardColor.R, actionId = "act-play-1")
        val playMsg = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(playMsg)
        assertTrue(playMsg!!.contains("\"type\":\"PLAY_CARD\""))
        assertTrue(playMsg.contains("\"cardId\":\"card_r_5\""))
        assertTrue(playMsg.contains("\"chosenColor\":\"R\""))

        client.sendDrawCard(actionId = "act-draw-1")
        val drawMsg = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(drawMsg)
        assertTrue(drawMsg!!.contains("\"type\":\"DRAW_CARD\""))

        client.sendCallUno(actionId = "act-uno-1")
        val unoMsg = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(unoMsg)
        assertTrue(unoMsg!!.contains("\"type\":\"CALL_UNO\""))

        client.disconnect()
    }

    @Test
    fun testChatDispatchAndReceive() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        webSocket.send("""{"v":1,"type":"WELCOME","seq":1,"d":{"you":{"userId":"u_chat_user","seat":0}}}""")
                    } else if (env.type == "CHAT_SEND") {
                        val bodyText = env.d?.get("text")?.toString()?.trim('"') ?: ""
                        webSocket.send("""
                            {
                              "v": 1,
                              "type": "EVENT",
                              "seq": 2,
                              "d": {
                                "kind": "CHAT_MESSAGE",
                                "id": "msg_chat_1",
                                "senderUserId": "u_chat_user",
                                "senderDisplayName": "Chatter",
                                "body": "$bodyText",
                                "createdAt": 1700000060000
                              }
                            }
                        """.trimIndent())
                    }
                }
            })
        )

        client.connect("ROOM05", "jwt_token_chat")
        // Discard HELLO
        incomingClientMessages.poll(3, TimeUnit.SECONDS)

        client.sendChatMessage("Good luck!")
        val chatSendMsg = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(chatSendMsg)
        assertTrue(chatSendMsg!!.contains("\"type\":\"CHAT_SEND\""))
        assertTrue(chatSendMsg.contains("\"text\":\"Good luck!\""))

        val chatReceived = client.chatFlow.first()
        assertEquals("msg_chat_1", chatReceived.id)
        assertEquals("u_chat_user", chatReceived.senderUserId)
        assertEquals("Chatter", chatReceived.senderDisplayName)
        assertEquals("Good luck!", chatReceived.body)
        assertEquals(1700000060000L, chatReceived.createdAt)

        client.disconnect()
    }

    @Test
    fun testAuthExpiredTriggersOnAuthExpiredAndReconnects() = runTest {
        var authExpiredCalled = false
        client.onAuthExpired = {
            authExpiredCalled = true
            "refreshed_jwt_token_999"
        }

        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        // Server rejects expired token
                        webSocket.send("""{"v":1,"type":"ERROR","d":{"code":"AUTH_EXPIRED"}}""")
                    }
                }
            })
        )

        // Queue second response for reconnection
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                }
            })
        )

        client.connect("ROOM06", "old_expired_jwt")

        // First HELLO with old token
        val msg1 = incomingClientMessages.poll(3, TimeUnit.SECONDS)
        assertNotNull(msg1)
        val env1 = UnoJson.decodeFromString(ClientEnvelope.serializer(), msg1!!)
        assertEquals("HELLO", env1.type)
        assertEquals("old_expired_jwt", env1.d?.get("token")?.toString()?.trim('"'))

        // Reconnected HELLO with refreshed token
        val msg2 = incomingClientMessages.poll(5, TimeUnit.SECONDS)
        assertNotNull(msg2)
        val env2 = UnoJson.decodeFromString(ClientEnvelope.serializer(), msg2!!)
        assertEquals("HELLO", env2.type)
        assertEquals("refreshed_jwt_token_999", env2.d?.get("token")?.toString()?.trim('"'))
        assertTrue(authExpiredCalled)

        client.disconnect()
    }

    @Test
    fun testServerDropTransitionsToReconnecting() = runTest {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    serverSideWs = webSocket
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    incomingClientMessages.add(text)
                    val env = UnoJson.decodeFromString(ClientEnvelope.serializer(), text)
                    if (env.type == "HELLO") {
                        webSocket.send("""{"v":1,"type":"WELCOME","seq":1,"d":{"you":{"userId":"u_drop","seat":0}}}""")
                    }
                }
            })
        )

        client.connect("ROOM07", "jwt_token_drop")

        // Wait for connected
        client.connectionState.first { it is WsConnectionState.Connected }

        // Server abruptly closes
        serverSideWs?.close(1001, "Server shutdown")

        // Client should transition to Reconnecting
        val state = client.connectionState.first { it is WsConnectionState.Reconnecting }
        assertTrue(state is WsConnectionState.Reconnecting)
        assertEquals(1, (state as WsConnectionState.Reconnecting).attempt)

        client.disconnect()
    }
}
