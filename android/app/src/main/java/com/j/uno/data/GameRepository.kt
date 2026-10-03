package com.j.uno.data

import com.j.uno.model.CardColor
import com.j.uno.model.ChatMessageDto
import com.j.uno.model.CreateRoomRequest
import com.j.uno.model.GameEvent
import com.j.uno.model.GameSnapshotView
import com.j.uno.model.RoomView
import com.j.uno.model.UnoCard
import com.j.uno.model.UserDto
import com.j.uno.net.SessionStore
import com.j.uno.net.UnoApiService
import com.j.uno.net.UnoWebSocketClient
import com.j.uno.net.WsConnectionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GameRepository @Inject constructor(
    private val api: UnoApiService,
    private val wsClient: UnoWebSocketClient,
    private val sessionStore: SessionStore
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val _currentUser = MutableStateFlow<UserDto?>(sessionStore.getUser())
    val currentUser: StateFlow<UserDto?> = _currentUser.asStateFlow()

    private val _activeRoom = MutableStateFlow<RoomView?>(null)
    val activeRoom: StateFlow<RoomView?> = _activeRoom.asStateFlow()

    private val _activeGame = MutableStateFlow<GameSnapshotView?>(null)
    val activeGame: StateFlow<GameSnapshotView?> = _activeGame.asStateFlow()

    private val _roundEnded = MutableStateFlow<GameEvent?>(null)
    val roundEnded: StateFlow<GameEvent?> = _roundEnded.asStateFlow()

    private val _chatMessages = MutableStateFlow<List<ChatMessageDto>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessageDto>> = _chatMessages.asStateFlow()

    private val _blockedUsers = MutableStateFlow<Set<String>>(emptySet())
    val blockedUsers: StateFlow<Set<String>> = _blockedUsers.asStateFlow()

    private val _errorMessage = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val errorMessage: SharedFlow<String> = _errorMessage.asSharedFlow()

    val wsConnectionState: StateFlow<WsConnectionState> = wsClient.connectionState

    init {
        scope.launch {
            wsClient.snapshotFlow.collect { snap ->
                _activeRoom.value = snap.room
                _activeGame.value = snap.game
                if (snap.chat.isNotEmpty()) {
                    _chatMessages.value = snap.chat
                }
                if (snap.game != null && snap.game.status == "PLAYING") {
                    _roundEnded.value = null
                }
            }
        }

        scope.launch {
            wsClient.chatFlow.collect { chatMsg ->
                _chatMessages.value = _chatMessages.value + chatMsg
            }
        }

        scope.launch {
            wsClient.eventFlow.collect { ev ->
                handleGameEvent(ev)
            }
        }

        scope.launch {
            wsClient.errorFlow.collect { err ->
                _errorMessage.tryEmit(err.code)
            }
        }

        wsClient.onAuthExpired = {
            val token = sessionStore.getRefreshToken()
            if (!token.isNullOrBlank()) {
                val refreshResult = api.refresh(token)
                val auth = refreshResult.getOrNull()
                if (auth != null) {
                    sessionStore.saveSession(auth.user, auth.accessToken, auth.refreshToken)
                    _currentUser.value = auth.user
                    auth.accessToken
                } else {
                    null
                }
            } else {
                null
            }
        }
    }

    private fun handleGameEvent(ev: GameEvent) {
        when (ev.kind) {
            "ROUND_ENDED" -> {
                _roundEnded.value = ev
            }
            "GAME_STARTED" -> {
                _roundEnded.value = null
            }
            "TURN_CHANGED" -> {
                val current = _activeGame.value ?: return
                val playerId = ev.playerId ?: return
                val deadline = ev.deadlineAt ?: (System.currentTimeMillis() + 30000L)
                val isMyTurn = (playerId == _currentUser.value?.id)
                _activeGame.value = current.copy(
                    currentPlayerId = playerId,
                    turnDeadlineAt = deadline,
                    players = current.players.map { p ->
                        p.copy(isCurrent = (p.userId == playerId))
                    },
                    hand = current.hand.copy(
                        canPass = false,
                        playableIds = if (isMyTurn) current.hand.cards.map { it.id } else emptyList()
                    )
                )
            }
            "CARD_PLAYED" -> {
                val current = _activeGame.value ?: return
                val playedCard = ev.card
                val newColor = ev.newColor ?: playedCard?.color ?: current.currentColor
                _activeGame.value = current.copy(
                    topCard = playedCard ?: current.topCard,
                    currentColor = newColor,
                    drawPileCount = ev.drawPileCount ?: current.drawPileCount,
                    players = current.players.map { p ->
                        if (p.userId == ev.playerId) {
                            p.copy(cardCount = ev.playerCardCount ?: maxOf(0, p.cardCount - 1))
                        } else p
                    }
                )
            }
            "DRAWN_PUBLIC" -> {
                val current = _activeGame.value ?: return
                val count = ev.count ?: 1
                val isMe = (ev.playerId == _currentUser.value?.id)
                _activeGame.value = current.copy(
                    drawPileCount = maxOf(0, current.drawPileCount - count),
                    players = current.players.map { p ->
                        if (p.userId == ev.playerId) {
                            p.copy(cardCount = p.cardCount + count)
                        } else p
                    },
                    hand = if (isMe) current.hand.copy(canPass = true) else current.hand
                )
            }
            "DIRECTION_FLIPPED" -> {
                val current = _activeGame.value ?: return
                _activeGame.value = current.copy(direction = ev.direction ?: (current.direction * -1))
            }
            "UNO_CALLED" -> {
                val current = _activeGame.value ?: return
                _activeGame.value = current.copy(
                    players = current.players.map { p ->
                        if (p.userId == ev.playerId) p.copy(hasCalledUno = true) else p
                    }
                )
            }
            "ROOM_UPDATED" -> {
                ev.room?.let { _activeRoom.value = it }
            }
            "PLAYER_DISCONNECTED" -> {
                val current = _activeGame.value
                val userId = ev.userId
                if (current != null && userId != null) {
                    _activeGame.value = current.copy(
                        players = current.players.map { p ->
                            if (p.userId == userId) p.copy(connected = false) else p
                        }
                    )
                }
            }
            "PLAYER_RECONNECTED" -> {
                val current = _activeGame.value
                val userId = ev.userId
                if (current != null && userId != null) {
                    _activeGame.value = current.copy(
                        players = current.players.map { p ->
                            if (p.userId == userId) p.copy(connected = true) else p
                        }
                    )
                }
            }
            "PLAYER_LEFT_GAME", "PLAYER_LEFT" -> {
                val current = _activeGame.value
                val userId = ev.userId
                if (current != null && userId != null) {
                    _activeGame.value = current.copy(
                        players = current.players.map { p ->
                            if (p.userId == userId) p.copy(left = true, connected = false) else p
                        }
                    )
                }
            }
        }
    }

    suspend fun loginAsGuest(displayName: String): Result<UserDto> {
        val result = api.createGuest(displayName)
        return result.map { auth ->
            sessionStore.saveSession(auth.user, auth.accessToken, auth.refreshToken)
            _currentUser.value = auth.user
            auth.user
        }
    }

    fun restoreSession(): Boolean {
        val user = sessionStore.getUser()
        val token = sessionStore.getAccessToken()
        return if (user != null && !token.isNullOrBlank()) {
            _currentUser.value = user
            true
        } else {
            false
        }
    }

    fun logout() {
        sessionStore.clear()
        _currentUser.value = null
        leaveRoom()
        _blockedUsers.value = emptySet()
    }

    suspend fun createRoom(isPublic: Boolean = false, maxPlayers: Int = 4): Result<RoomView> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.createRoom(token, CreateRoomRequest(isPublic = isPublic, maxPlayers = maxPlayers))
        return result.onSuccess { room ->
            _activeRoom.value = room
            connectToRoomWs(room.code, token)
        }
    }

    suspend fun quickPlay(): Result<RoomView> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.quickplay(token)
        return result.onSuccess { room ->
            _activeRoom.value = room
            connectToRoomWs(room.code, token)
        }
    }

    suspend fun joinRoom(code: String): Result<RoomView> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.joinRoom(token, code)
        return result.onSuccess { room ->
            _activeRoom.value = room
            connectToRoomWs(room.code, token)
        }
    }

    fun leaveRoom() {
        val code = _activeRoom.value?.code
        val token = sessionStore.getAccessToken()
        if (!code.isNullOrBlank() && !token.isNullOrBlank()) {
            wsClient.sendLeave()
            scope.launch {
                api.leaveRoom(token, code)
            }
        }
        wsClient.disconnect()
        _activeRoom.value = null
        _activeGame.value = null
        _roundEnded.value = null
        _chatMessages.value = emptyList()
    }

    suspend fun startRoom(): Result<Unit> {
        val code = _activeRoom.value?.code ?: return Result.failure(IllegalStateException("No active room"))
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        return api.startRoom(token, code)
    }

    suspend fun fetchMyRooms(): Result<List<RoomView>> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        return api.getMyRooms(token)
    }

    private fun connectToRoomWs(code: String, token: String) {
        wsClient.disconnect()
        wsClient.connect(code, token)
    }

    // -------------------------------------------------------------
    // Player Actions
    // -------------------------------------------------------------

    fun playCard(card: UnoCard, chosenColor: CardColor? = null) {
        // Optimistic UX: remove card from hand locally
        val current = _activeGame.value
        if (current != null) {
            val updatedHandCards = current.hand.cards.filter { it.id != card.id }
            _activeGame.value = current.copy(
                hand = current.hand.copy(
                    cards = updatedHandCards,
                    playableIds = emptyList()
                )
            )
        }
        wsClient.sendPlayCard(card.id, chosenColor)
    }

    fun drawCard() {
        wsClient.sendDrawCard()
    }

    fun pass() {
        wsClient.sendPass()
    }

    fun callUno() {
        wsClient.sendCallUno()
    }

    fun catchUno(targetUserId: String) {
        wsClient.sendCatchUno(targetUserId)
    }

    fun clearRoundResult() {
        _roundEnded.value = null
    }

    // -------------------------------------------------------------
    // Chat & Moderation Actions
    // -------------------------------------------------------------

    fun sendChatMessage(text: String): String {
        return wsClient.sendChatMessage(text)
    }

    suspend fun blockUser(targetUserId: String): Result<Unit> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.blockUser(token, targetUserId)
        if (result.isSuccess) {
            _blockedUsers.value = _blockedUsers.value + targetUserId
        }
        return result
    }

    suspend fun unblockUser(targetUserId: String): Result<Unit> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.unblockUser(token, targetUserId)
        if (result.isSuccess) {
            _blockedUsers.value = _blockedUsers.value - targetUserId
        }
        return result
    }

    suspend fun refreshBlockedUsers(): Result<List<String>> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        val result = api.getBlockedUsers(token)
        result.onSuccess { list ->
            _blockedUsers.value = list.toSet()
        }
        return result
    }

    suspend fun reportUser(
        targetUserId: String,
        category: String,
        roomCode: String? = null,
        messageId: String? = null,
        reason: String? = null
    ): Result<String> {
        val token = sessionStore.getAccessToken() ?: return Result.failure(IllegalStateException("Not authenticated"))
        return api.reportUser(token, targetUserId, category, roomCode, messageId, reason)
    }
}
