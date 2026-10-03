package com.j.uno.ui

import com.j.uno.data.GameRepository
import com.j.uno.model.CardColor
import com.j.uno.model.CardKind
import com.j.uno.model.GameSnapshotView
import com.j.uno.model.PublicPlayerView
import com.j.uno.model.RoomSettings
import com.j.uno.model.RoomView
import com.j.uno.model.SelfHandView
import com.j.uno.model.UnoCard
import com.j.uno.model.UserDto
import com.j.uno.net.InMemorySessionStore
import com.j.uno.net.UnoApiService
import com.j.uno.net.UnoWebSocketClient
import com.j.uno.ui.auth.AuthViewModel
import com.j.uno.ui.game.GameViewModel
import com.j.uno.ui.lobby.LobbyViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ViewModelsTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var server: MockWebServer
    private lateinit var sessionStore: InMemorySessionStore
    private lateinit var api: UnoApiService
    private lateinit var wsClient: UnoWebSocketClient
    private lateinit var repository: GameRepository

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        server = MockWebServer()
        server.start()

        val baseUrl = server.url("/").toString().removeSuffix("/")
        val wsUrl = "ws://${server.hostName}:${server.port}"

        sessionStore = InMemorySessionStore()
        api = UnoApiService(baseUrl = baseUrl, client = OkHttpClient.Builder().build())
        wsClient = UnoWebSocketClient(wsBaseUrl = wsUrl, client = OkHttpClient.Builder().build())
        repository = GameRepository(api = api, wsClient = wsClient, sessionStore = sessionStore)
    }

    @After
    fun teardown() {
        wsClient.disconnect()
        try {
            server.shutdown()
        } catch (_: Exception) {}
        Dispatchers.resetMain()
    }

    @Test
    fun testAuthViewModelValidationAndGuestLogin() = runTest(testDispatcher) {
        val authVm = AuthViewModel(repository)

        // Invalid short name
        authVm.onDisplayNameChanged("A")
        authVm.signInAsGuest()
        assertNotNull(authVm.uiState.value.error)
        assertFalse(authVm.uiState.value.isAuthenticated)

        // Valid name
        val json = """
            {
              "user": {"id": "u_test", "handle": "h_test", "displayName": "Player Alice", "avatarId": 1},
              "accessToken": "jwt.alice",
              "refreshToken": "refresh.alice"
            }
        """.trimIndent()
        server.enqueue(MockResponse().setResponseCode(201).setBody(json))

        authVm.onDisplayNameChanged("Player Alice")
        authVm.signInAsGuest()

        val state = authVm.uiState.first { it.isAuthenticated }
        assertTrue(state.isAuthenticated)
        assertEquals("Player Alice", state.user?.displayName)
        assertNull(state.error)
    }

    @Test
    fun testLobbyViewModelInputFilteringAndValidation() = runTest(testDispatcher) {
        val lobbyVm = LobbyViewModel(repository)

        lobbyVm.onRoomCodeChanged("abc-123-xyz")
        // Should uppercase and filter to 6 alphanumeric chars max
        assertEquals("ABC123", lobbyVm.uiState.value.roomCodeInput)

        // Joining with < 6 chars triggers error
        lobbyVm.onRoomCodeChanged("AB")
        lobbyVm.joinRoom()
        assertNotNull(lobbyVm.uiState.value.error)
    }

    @Test
    fun testGameViewModelTurnAndWildCardColorSelection() = runTest(testDispatcher) {
        // Setup authenticated user
        val myUser = UserDto("u_me", "h_me", "Me", 0)
        sessionStore.saveSession(myUser, "token", "refresh")
        repository.restoreSession()

        val gameVm = GameViewModel(repository)

        // Inject simulated snapshot into client flow
        val wildCard = UnoCard(id = "c_w_0", color = null, kind = CardKind.WILD)
        val numberCard = UnoCard(id = "c_r_5_0", color = CardColor.R, kind = CardKind.NUMBER, value = 5)

        val snapshot = com.j.uno.model.SnapshotData(
            room = RoomView(
                code = "ROOM01",
                hostUserId = "u_me",
                isPublic = false,
                status = "PLAYING",
                maxPlayers = 2,
                settings = RoomSettings(),
                members = emptyList()
            ),
            game = GameSnapshotView(
                gameId = "g_1",
                roomCode = "ROOM01",
                status = "PLAYING",
                direction = 1,
                currentPlayerId = "u_me", // It's my turn
                currentColor = CardColor.R,
                topCard = UnoCard(id = "top_1", color = CardColor.R, kind = CardKind.NUMBER, value = 1),
                drawPileCount = 90,
                discardPileCount = 2,
                turnSeq = 1,
                turnDeadlineAt = System.currentTimeMillis() + 30000L,
                players = listOf(
                    PublicPlayerView(userId = "u_me", seat = 0, displayName = "Me", cardCount = 2, isCurrent = true),
                    PublicPlayerView(userId = "u_opp", seat = 1, displayName = "Opp", cardCount = 7, isCurrent = false)
                ),
                hand = SelfHandView(
                    cards = listOf(wildCard, numberCard),
                    playableIds = listOf(wildCard.id, numberCard.id),
                    canPass = false
                )
            )
        )

        // Pushing snapshot over mock ws
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : okhttp3.WebSocketListener() {
                override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                    val snapJson = """
                        {
                          "v": 1,
                          "type": "SNAPSHOT",
                          "seq": 1,
                          "d": ${com.j.uno.model.UnoJson.encodeToString(com.j.uno.model.SnapshotData.serializer(), snapshot)}
                        }
                    """.trimIndent()
                    webSocket.send(snapJson)
                }
            })
        )

        wsClient.connect("ROOM01", "token")
        // Wait for GameViewModel to receive game state
        val state = gameVm.uiState.first { it.topCard != null }
        assertTrue(state.isMyTurn)
        assertEquals(2, state.myHand.size)
        assertEquals(CardColor.R, state.activeColor)

        // Clicking normal card plays directly
        gameVm.onCardClicked(numberCard)
        assertNull(gameVm.uiState.value.pendingColorSelectionCard)

        // Clicking wild card triggers color picker state
        gameVm.onCardClicked(wildCard)
        assertEquals(wildCard.id, gameVm.uiState.value.pendingColorSelectionCard?.id)

        // Choosing color dismisses picker and sends play
        gameVm.onColorChosen(CardColor.B)
        assertNull(gameVm.uiState.value.pendingColorSelectionCard)

        gameVm.leaveGame()
    }

    @Test
    fun testGameViewModelChatAndModerationState() = runTest(testDispatcher) {
        val myUser = UserDto("u_me", "h_me", "Me", 0)
        sessionStore.saveSession(myUser, "token", "refresh")
        repository.restoreSession()

        val gameVm = GameViewModel(repository)
        testScheduler.advanceUntilIdle()

        // Chat open / close
        assertFalse(gameVm.uiState.value.isChatOpen)
        gameVm.openChat()
        assertTrue(gameVm.uiState.value.isChatOpen)
        gameVm.closeChat()
        assertFalse(gameVm.uiState.value.isChatOpen)

        // Moderation target selection
        gameVm.openModeration("u_bad_guy", "Bad Guy", "msg_1")
        assertNotNull(gameVm.uiState.value.moderationTarget)
        assertEquals("u_bad_guy", gameVm.uiState.value.moderationTarget?.userId)
        assertEquals("msg_1", gameVm.uiState.value.moderationTarget?.messageId)

        // Cannot moderate self
        gameVm.openModeration("u_me", "Me")
        assertEquals("u_bad_guy", gameVm.uiState.value.moderationTarget?.userId)

        gameVm.closeModeration()
        assertNull(gameVm.uiState.value.moderationTarget)

        // Block & Unblock API calls
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))
        gameVm.blockUser("u_bad_guy")
        val blockedState = gameVm.uiState.first { "u_bad_guy" in it.blockedUsers }
        assertTrue(blockedState.blockedUsers.contains("u_bad_guy"))

        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))
        gameVm.unblockUser("u_bad_guy")
        val unblockedState = gameVm.uiState.first { "u_bad_guy" !in it.blockedUsers }
        assertFalse(unblockedState.blockedUsers.contains("u_bad_guy"))
    }

    @Test
    fun testLobbyViewModelChatAndModerationState() = runTest(testDispatcher) {
        val myUser = UserDto("u_me", "h_me", "Me", 0)
        sessionStore.saveSession(myUser, "token", "refresh")
        repository.restoreSession()

        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"rooms\":[]}"))
        val lobbyVm = LobbyViewModel(repository)
        testScheduler.advanceUntilIdle()

        // Chat open / close
        assertFalse(lobbyVm.uiState.value.isChatOpen)
        lobbyVm.openChat()
        assertTrue(lobbyVm.uiState.value.isChatOpen)
        lobbyVm.closeChat()
        assertFalse(lobbyVm.uiState.value.isChatOpen)

        // Moderation
        lobbyVm.openModeration("u_troll", "Troll Player")
        assertNotNull(lobbyVm.uiState.value.moderationTarget)
        assertEquals("u_troll", lobbyVm.uiState.value.moderationTarget?.userId)

        lobbyVm.closeModeration()
        assertNull(lobbyVm.uiState.value.moderationTarget)
    }

    @Test
    fun testGameViewModelRematchAndHostActions() = runTest(testDispatcher) {
        val myUser = UserDto("u_me", "h_me", "Me", 0)
        sessionStore.saveSession(myUser, "token", "refresh")
        repository.restoreSession()

        val room = RoomView(
            code = "ROOM42",
            hostUserId = "u_me",
            isPublic = false,
            status = "ROUND_OVER",
            maxPlayers = 4,
            members = listOf(
                com.j.uno.model.RoomMemberView("u_me", "h_me", "Me", 0, "PLAYER", true),
                com.j.uno.model.RoomMemberView("u_opp", "h_opp", "Opp", 1, "PLAYER", false)
            )
        )
        val roundEndedEvent = com.j.uno.model.GameEvent(
            kind = "ROUND_ENDED",
            winnerUserId = "u_me",
            scores = listOf(
                com.j.uno.model.RoundScore("u_me", 0),
                com.j.uno.model.RoundScore("u_opp", 25)
            )
        )
        // Enqueue create room response and ws upgrade
        server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                com.j.uno.model.UnoJson.encodeToString(
                    com.j.uno.model.RoomResponse.serializer(),
                    com.j.uno.model.RoomResponse(room)
                )
            )
        )
        server.enqueue(
            MockResponse().withWebSocketUpgrade(object : okhttp3.WebSocketListener() {
                override fun onOpen(webSocket: okhttp3.WebSocket, response: okhttp3.Response) {
                    val evJson = """
                        {
                          "v": 1,
                          "type": "EVENT",
                          "seq": 2,
                          "d": ${com.j.uno.model.UnoJson.encodeToString(com.j.uno.model.GameEvent.serializer(), roundEndedEvent)}
                        }
                    """.trimIndent()
                    webSocket.send(evJson)
                }
            })
        )
        repository.createRoom()

        val gameVm = GameViewModel(repository)
        testScheduler.advanceUntilIdle()

        // Host verification
        val hostState = gameVm.uiState.first { it.isHost }
        assertTrue(hostState.isHost)
        assertEquals("u_me", hostState.myUserId)

        val endedState = gameVm.uiState.first { it.roundResult != null }
        assertNotNull(endedState.roundResult)
        assertEquals("u_me", endedState.roundResult?.winnerUserId)

        // Dismiss round result
        gameVm.dismissRoundResult()
        assertNull(gameVm.uiState.value.roundResult)

        // Start next round as host
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"ok\":true}"))
        gameVm.startNextRound()
        testScheduler.advanceUntilIdle()
        assertNull(gameVm.uiState.value.alertMessage)
    }
}
