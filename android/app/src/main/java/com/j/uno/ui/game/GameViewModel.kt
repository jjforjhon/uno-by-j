package com.j.uno.ui.game

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.j.uno.audio.SoundEffect
import com.j.uno.audio.SoundManager
import com.j.uno.data.GameRepository
import com.j.uno.model.CardColor
import com.j.uno.model.CardKind
import com.j.uno.model.ChatMessageDto
import com.j.uno.model.GameEvent
import com.j.uno.model.PublicPlayerView
import com.j.uno.model.UnoCard
import com.j.uno.net.WsConnectionState
import com.j.uno.ui.chat.ModerationTarget
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.max

data class GameUiState(
    val myUserId: String = "",
    val isHost: Boolean = false,
    val isMyTurn: Boolean = false,
    val myHand: List<UnoCard> = emptyList(),
    val playableCardIds: Set<String> = emptySet(),
    val canPass: Boolean = false,
    val topCard: UnoCard? = null,
    val activeColor: CardColor? = null,
    val opponents: List<PublicPlayerView> = emptyList(),
    val drawPileCount: Int = 0,
    val turnDeadlineAt: Long = 0L,
    val secondsRemaining: Int = 0,
    val direction: Int = 1,
    val pendingUnoOffenderId: String? = null,
    val roundResult: GameEvent? = null,
    val wsState: WsConnectionState = WsConnectionState.Disconnected,
    val pendingColorSelectionCard: UnoCard? = null,
    val alertMessage: String? = null,
    val chatMessages: List<ChatMessageDto> = emptyList(),
    val blockedUsers: Set<String> = emptySet(),
    val isChatOpen: Boolean = false,
    val moderationTarget: ModerationTarget? = null,
    val unreadChatCount: Int = 0
)

@HiltViewModel
class GameViewModel @Inject constructor(
    private val repository: GameRepository,
    private val soundManager: SoundManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.currentUser.collect { user ->
                val myId = user?.id.orEmpty()
                val hostId = repository.activeRoom.value?.hostUserId
                _uiState.update {
                    it.copy(
                        myUserId = myId,
                        isHost = (hostId != null && hostId == myId)
                    )
                }
            }
        }

        viewModelScope.launch {
            repository.activeRoom.collect { room ->
                val myId = _uiState.value.myUserId.ifEmpty { repository.currentUser.value?.id.orEmpty() }
                _uiState.update {
                    it.copy(
                        isHost = (room?.hostUserId != null && room.hostUserId == myId)
                    )
                }
            }
        }

        viewModelScope.launch {
            repository.activeGame.collect { game ->
                if (game != null) {
                    val myId = repository.currentUser.value?.id.orEmpty()
                    val isMyTurn = (game.currentPlayerId == myId)
                    val wasMyTurn = _uiState.value.isMyTurn
                    val oldTop = _uiState.value.topCard
                    val oldDraw = _uiState.value.drawPileCount
                    val opponents = game.players.filter { it.userId != myId }

                    // Sound cues on game changes
                    if (!wasMyTurn && isMyTurn) {
                        soundManager.play(SoundEffect.YOUR_TURN)
                    }
                    if (oldTop != null && game.topCard.id != oldTop.id) {
                        soundManager.play(SoundEffect.CARD_PLAY)
                    } else if (oldDraw > 0 && game.drawPileCount < oldDraw) {
                        soundManager.play(SoundEffect.CARD_DRAW)
                    }

                    _uiState.update {
                        it.copy(
                            myHand = game.hand.cards,
                            playableCardIds = game.hand.playableIds.toSet(),
                            canPass = game.hand.canPass,
                            isMyTurn = isMyTurn,
                            topCard = game.topCard,
                            activeColor = game.currentColor,
                            opponents = opponents,
                            drawPileCount = game.drawPileCount,
                            turnDeadlineAt = game.turnDeadlineAt,
                            direction = game.direction,
                            pendingUnoOffenderId = game.pendingUnoOffenderId
                        )
                    }
                    startCountdownTimer(game.turnDeadlineAt)
                } else {
                    stopCountdownTimer()
                    _uiState.update {
                        it.copy(
                            topCard = null,
                            myHand = emptyList(),
                            playableCardIds = emptySet(),
                            canPass = false,
                            isMyTurn = false,
                            opponents = emptyList(),
                            roundResult = null,
                            activeColor = null,
                            pendingColorSelectionCard = null,
                            alertMessage = null
                        )
                    }
                }
            }
        }

        viewModelScope.launch {
            repository.roundEnded.collect { result ->
                if (result != null) {
                    val myId = repository.currentUser.value?.id.orEmpty()
                    if (result.winnerUserId == myId) {
                        soundManager.play(SoundEffect.VICTORY)
                    } else {
                        soundManager.play(SoundEffect.ROUND_LOST)
                    }
                }
                _uiState.update { it.copy(roundResult = result) }
            }
        }

        viewModelScope.launch {
            repository.wsConnectionState.collect { ws ->
                _uiState.update { it.copy(wsState = ws) }
            }
        }

        viewModelScope.launch {
            repository.errorMessage.collect { err ->
                _uiState.update { it.copy(alertMessage = err) }
            }
        }

        viewModelScope.launch {
            repository.chatMessages.collect { messages ->
                _uiState.update { current ->
                    val newUnread = if (!current.isChatOpen) {
                        val lastCount = current.chatMessages.size
                        val diff = max(0, messages.size - lastCount)
                        current.unreadChatCount + diff
                    } else 0
                    current.copy(chatMessages = messages, unreadChatCount = newUnread)
                }
            }
        }

        viewModelScope.launch {
            repository.blockedUsers.collect { blocked ->
                _uiState.update { it.copy(blockedUsers = blocked) }
            }
        }
    }

    private var timerJob: Job? = null

    private fun startCountdownTimer(deadline: Long) {
        timerJob?.cancel()
        if (deadline <= 0L) return
        timerJob = viewModelScope.launch {
            while (isActive) {
                val remainingMs = max(0L, deadline - System.currentTimeMillis())
                val seconds = ((remainingMs + 999L) / 1000L).toInt()
                _uiState.update { it.copy(secondsRemaining = seconds) }
                if (remainingMs <= 0L) break
                delay(500L)
            }
        }
    }

    private fun stopCountdownTimer() {
        timerJob?.cancel()
        timerJob = null
    }

    fun onCardClicked(card: UnoCard) {
        if (!_uiState.value.isMyTurn) {
            soundManager.play(SoundEffect.ERROR)
            return
        }
        if (card.id !in _uiState.value.playableCardIds) {
            soundManager.play(SoundEffect.ERROR)
            return
        }

        soundManager.play(SoundEffect.CARD_PLAY)
        if (card.kind == CardKind.WILD || card.kind == CardKind.WILD4) {
            // Require inline color choice
            _uiState.update { it.copy(pendingColorSelectionCard = card) }
        } else {
            repository.playCard(card, null)
        }
    }

    fun onColorChosen(color: CardColor) {
        val card = _uiState.value.pendingColorSelectionCard ?: return
        _uiState.update { it.copy(pendingColorSelectionCard = null) }
        soundManager.play(SoundEffect.CARD_PLAY)
        repository.playCard(card, color)
    }

    fun dismissColorPicker() {
        soundManager.play(SoundEffect.CLICK)
        _uiState.update { it.copy(pendingColorSelectionCard = null) }
    }

    fun onDrawClicked() {
        if (!_uiState.value.isMyTurn) {
            soundManager.play(SoundEffect.ERROR)
            return
        }
        soundManager.play(SoundEffect.CARD_DRAW)
        repository.drawCard()
    }

    fun onPassClicked() {
        if (!_uiState.value.isMyTurn || !_uiState.value.canPass) return
        soundManager.play(SoundEffect.CLICK)
        repository.pass()
    }

    fun onCallUnoClicked() {
        soundManager.play(SoundEffect.UNO_CALL)
        repository.callUno()
    }

    fun onCatchUnoClicked(targetUserId: String) {
        soundManager.play(SoundEffect.UNO_CALL)
        repository.catchUno(targetUserId)
    }

    fun dismissAlert() {
        _uiState.update { it.copy(alertMessage = null) }
    }

    fun dismissRoundResult() {
        _uiState.update { it.copy(roundResult = null) }
        repository.clearRoundResult()
    }

    fun startNextRound() {
        soundManager.play(SoundEffect.CLICK)
        viewModelScope.launch {
            val res = repository.startRoom()
            if (res.isFailure) {
                _uiState.update {
                    it.copy(alertMessage = res.exceptionOrNull()?.message ?: "Failed to start next round")
                }
            } else {
                dismissRoundResult()
            }
        }
    }

    fun leaveGame() {
        soundManager.play(SoundEffect.CLICK)
        stopCountdownTimer()
        _uiState.value = GameUiState()
        repository.leaveRoom()
    }

    fun openChat() {
        _uiState.update { it.copy(isChatOpen = true, unreadChatCount = 0) }
    }

    fun closeChat() {
        _uiState.update { it.copy(isChatOpen = false) }
    }

    fun sendChatMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isNotEmpty()) {
            repository.sendChatMessage(trimmed)
        }
    }

    fun openModeration(userId: String, displayName: String, messageId: String? = null) {
        if (userId == _uiState.value.myUserId) return
        _uiState.update {
            it.copy(moderationTarget = ModerationTarget(userId, displayName, messageId))
        }
    }

    fun closeModeration() {
        _uiState.update { it.copy(moderationTarget = null) }
    }

    fun blockUser(userId: String) {
        viewModelScope.launch {
            val res = repository.blockUser(userId)
            if (res.isSuccess) {
                _uiState.update { it.copy(alertMessage = "Player blocked") }
            }
        }
    }

    fun unblockUser(userId: String) {
        viewModelScope.launch {
            val res = repository.unblockUser(userId)
            if (res.isSuccess) {
                _uiState.update { it.copy(alertMessage = "Player unblocked") }
            }
        }
    }

    fun reportUser(targetUserId: String, category: String, messageId: String? = null, reason: String? = null) {
        viewModelScope.launch {
            val roomCode = repository.activeRoom.value?.code
            val res = repository.reportUser(targetUserId, category, roomCode, messageId, reason)
            if (res.isSuccess) {
                _uiState.update { it.copy(alertMessage = "Report submitted successfully") }
            } else {
                _uiState.update { it.copy(alertMessage = "Failed to submit report") }
            }
        }
    }
}
