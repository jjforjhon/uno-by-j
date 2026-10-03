package com.j.uno.net

import com.j.uno.model.AckData
import com.j.uno.model.CardColor
import com.j.uno.model.ChatMessageDto
import com.j.uno.model.ClientEnvelope
import com.j.uno.model.GameEvent
import com.j.uno.model.ServerErrorData
import com.j.uno.model.ServerEnvelope
import com.j.uno.model.SnapshotData
import com.j.uno.model.UnoJson
import com.j.uno.model.WelcomeData
import com.j.uno.model.WelcomeYou
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

sealed interface WsConnectionState {
    data object Disconnected : WsConnectionState
    data object Connecting : WsConnectionState
    data object Authenticating : WsConnectionState
    data class Connected(val you: WelcomeYou, val roomCode: String) : WsConnectionState
    data class Reconnecting(val attempt: Int, val error: Throwable? = null) : WsConnectionState
}

class UnoWebSocketClient(
    private val wsBaseUrl: String = "ws://10.0.2.2:8787",
    private val client: OkHttpClient = OkHttpClient.Builder().build(),
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {
    private val _connectionState = MutableStateFlow<WsConnectionState>(WsConnectionState.Disconnected)
    val connectionState: StateFlow<WsConnectionState> = _connectionState.asStateFlow()

    private val _snapshotFlow = MutableSharedFlow<SnapshotData>(replay = 1)
    val snapshotFlow: SharedFlow<SnapshotData> = _snapshotFlow.asSharedFlow()

    private val _eventFlow = MutableSharedFlow<GameEvent>(replay = 16, extraBufferCapacity = 64)
    val eventFlow: SharedFlow<GameEvent> = _eventFlow.asSharedFlow()

    private val _chatFlow = MutableSharedFlow<ChatMessageDto>(replay = 16, extraBufferCapacity = 64)
    val chatFlow: SharedFlow<ChatMessageDto> = _chatFlow.asSharedFlow()

    private val _errorFlow = MutableSharedFlow<ServerErrorData>(replay = 16, extraBufferCapacity = 16)
    val errorFlow: SharedFlow<ServerErrorData> = _errorFlow.asSharedFlow()

    private val _ackFlow = MutableSharedFlow<AckData>(replay = 16, extraBufferCapacity = 16)
    val ackFlow: SharedFlow<AckData> = _ackFlow.asSharedFlow()

    private var activeWs: WebSocket? = null
    private var currentRoomCode: String? = null
    private var currentToken: String? = null
    private var deliberatelyClosed = AtomicBoolean(false)
    private var reconnectJob: Job? = null
    private var pingJob: Job? = null
    private var reconnectAttempts = 0

    var lastSeq: Int? = null
        private set

    var onAuthExpired: (suspend () -> String?)? = null

    fun updateToken(token: String) {
        currentToken = token
    }

    fun connect(roomCode: String, token: String) {
        deliberatelyClosed.set(false)
        currentRoomCode = roomCode
        currentToken = token
        reconnectAttempts = 0
        establishConnection()
    }

    fun disconnect(reason: String = "Normal closure") {
        deliberatelyClosed.set(true)
        reconnectJob?.cancel()
        reconnectJob = null
        stopHeartbeat()
        activeWs?.close(1000, reason)
        activeWs = null
        _connectionState.value = WsConnectionState.Disconnected
    }

    private fun establishConnection() {
        val code = currentRoomCode ?: return
        val url = "$wsBaseUrl/room/$code/ws"

        stopHeartbeat()
        _connectionState.value = if (reconnectAttempts > 0) {
            WsConnectionState.Reconnecting(reconnectAttempts)
        } else {
            WsConnectionState.Connecting
        }

        val request = Request.Builder()
            .url(url)
            .build()

        activeWs = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connectionState.value = WsConnectionState.Authenticating
                val token = currentToken
                if (token != null) {
                    sendEnvelope(ClientEnvelope.hello(token))
                } else {
                    webSocket.close(4001, "No auth token")
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleIncomingMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                handleDisconnect(null)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handleDisconnect(t)
            }
        })
    }

    private fun handleIncomingMessage(raw: String) {
        val envelope = try {
            UnoJson.decodeFromString(ServerEnvelope.serializer(), raw)
        } catch (_: Exception) {
            return
        }

        // Sequence tracking & gap detection
        val seq = envelope.seq
        if (seq != null) {
            val previous = lastSeq
            if (previous != null && seq > previous + 1) {
                // Gap detected! Request sync recovery
                sendEnvelope(ClientEnvelope.syncReq(UUID.randomUUID().toString(), previous))
            }
            lastSeq = max(previous ?: 0, seq)
        }

        when (envelope.type) {
            "WELCOME" -> {
                envelope.d?.let { dataElement ->
                    try {
                        val welcome = UnoJson.decodeFromJsonElement(WelcomeData.serializer(), dataElement)
                        reconnectAttempts = 0
                        _connectionState.value = WsConnectionState.Connected(
                            you = welcome.you,
                            roomCode = currentRoomCode.orEmpty()
                        )
                        startHeartbeat()
                        // If reconnecting with a known lastSeq, sync state
                        val priorSeq = lastSeq
                        if (priorSeq != null && priorSeq > 0) {
                            sendEnvelope(ClientEnvelope.syncReq(UUID.randomUUID().toString(), priorSeq))
                        }
                    } catch (_: Exception) {}
                }
            }
            "SNAPSHOT" -> {
                envelope.d?.let { dataElement ->
                    try {
                        val snapshot = UnoJson.decodeFromJsonElement(SnapshotData.serializer(), dataElement)
                        _snapshotFlow.tryEmit(snapshot)
                    } catch (_: Exception) {}
                }
            }
            "EVENT" -> {
                envelope.d?.let { dataElement ->
                    try {
                        val event = UnoJson.decodeFromJsonElement(GameEvent.serializer(), dataElement)
                        if (event.kind == "CHAT_MESSAGE" && event.id != null && event.body != null) {
                            val chatMsg = ChatMessageDto(
                                id = event.id,
                                roomCode = currentRoomCode.orEmpty(),
                                senderUserId = event.senderUserId.orEmpty(),
                                senderDisplayName = event.senderDisplayName ?: "Player",
                                body = event.body,
                                createdAt = event.createdAt ?: System.currentTimeMillis()
                            )
                            _chatFlow.tryEmit(chatMsg)
                        } else {
                            _eventFlow.tryEmit(event)
                        }
                    } catch (_: Exception) {}
                }
            }
            "ACK" -> {
                envelope.d?.let { dataElement ->
                    try {
                        val ack = UnoJson.decodeFromJsonElement(AckData.serializer(), dataElement)
                        _ackFlow.tryEmit(ack)
                    } catch (_: Exception) {}
                }
            }
            "ERROR" -> {
                envelope.d?.let { dataElement ->
                    try {
                        val err = UnoJson.decodeFromJsonElement(ServerErrorData.serializer(), dataElement)
                        _errorFlow.tryEmit(err)
                        if (err.code == "AUTH_EXPIRED" || err.code == "AUTH_REQUIRED") {
                            scope.launch {
                                val refreshed = onAuthExpired?.invoke()
                                if (refreshed != null) {
                                    currentToken = refreshed
                                    reconnectAttempts = 0
                                    establishConnection()
                                }
                            }
                        }
                    } catch (_: Exception) {}
                }
            }
            "PONG" -> {
                // Keepalive acknowledged
            }
        }
    }

    private fun handleDisconnect(error: Throwable?) {
        stopHeartbeat()
        activeWs = null

        if (deliberatelyClosed.get()) {
            _connectionState.value = WsConnectionState.Disconnected
            return
        }

        reconnectAttempts++
        _connectionState.value = WsConnectionState.Reconnecting(reconnectAttempts, error)

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val baseBackoffMs = min(10000L, 500L * (1L shl min(reconnectAttempts, 5)))
            val jitterMs = (0..500).random().toLong()
            val backoffMs = baseBackoffMs + jitterMs
            delay(backoffMs)
            if (!deliberatelyClosed.get()) {
                establishConnection()
            }
        }
    }

    private fun startHeartbeat() {
        stopHeartbeat()
        pingJob = scope.launch {
            while (isActive) {
                delay(25000L)
                sendPing()
            }
        }
    }

    private fun stopHeartbeat() {
        pingJob?.cancel()
        pingJob = null
    }

    fun sendEnvelope(envelope: ClientEnvelope): Boolean {
        val ws = activeWs ?: return false
        val json = UnoJson.encodeToString(ClientEnvelope.serializer(), envelope)
        return ws.send(json)
    }

    // -------------------------------------------------------------
    // Game Action Dispatches
    // -------------------------------------------------------------

    fun sendPlayCard(
        cardId: String,
        chosenColor: CardColor? = null,
        actionId: String = UUID.randomUUID().toString(),
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.playCard(reqId, actionId, cardId, chosenColor))
        return actionId
    }

    fun sendDrawCard(
        actionId: String = UUID.randomUUID().toString(),
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.drawCard(reqId, actionId))
        return actionId
    }

    fun sendPass(
        actionId: String = UUID.randomUUID().toString(),
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.pass(reqId, actionId))
        return actionId
    }

    fun sendCallUno(
        actionId: String = UUID.randomUUID().toString(),
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.callUno(reqId, actionId))
        return actionId
    }

    fun sendCatchUno(
        targetPlayerId: String,
        actionId: String = UUID.randomUUID().toString(),
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.catchUno(reqId, actionId, targetPlayerId))
        return actionId
    }

    fun sendSyncReq(sinceSeq: Int = lastSeq ?: 0, reqId: String = UUID.randomUUID().toString()) {
        sendEnvelope(ClientEnvelope.syncReq(reqId, sinceSeq))
    }

    fun sendPing(reqId: String = UUID.randomUUID().toString()) {
        sendEnvelope(ClientEnvelope.ping(reqId))
    }

    fun sendLeave(reqId: String = UUID.randomUUID().toString()) {
        sendEnvelope(ClientEnvelope.leave(reqId))
    }

    fun sendChatMessage(
        text: String,
        reqId: String = UUID.randomUUID().toString()
    ): String {
        sendEnvelope(ClientEnvelope.chatSend(reqId, text))
        return reqId
    }
}
