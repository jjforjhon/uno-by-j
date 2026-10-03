package com.j.uno.ui.lobby

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.j.uno.data.GameRepository
import com.j.uno.model.ChatMessageDto
import com.j.uno.model.RoomView
import com.j.uno.model.UserDto
import com.j.uno.ui.chat.ModerationTarget
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.max

data class LobbyUiState(
    val user: UserDto? = null,
    val roomCodeInput: String = "",
    val activeRoom: RoomView? = null,
    val myRooms: List<RoomView> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val isGameActive: Boolean = false,
    val chatMessages: List<ChatMessageDto> = emptyList(),
    val blockedUsers: Set<String> = emptySet(),
    val isChatOpen: Boolean = false,
    val moderationTarget: ModerationTarget? = null,
    val unreadChatCount: Int = 0
)

@HiltViewModel
class LobbyViewModel @Inject constructor(
    private val repository: GameRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LobbyUiState())
    val uiState: StateFlow<LobbyUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.currentUser.collect { user ->
                _uiState.update { it.copy(user = user) }
            }
        }

        viewModelScope.launch {
            repository.activeRoom.collect { room ->
                _uiState.update { it.copy(activeRoom = room) }
            }
        }

        viewModelScope.launch {
            repository.activeGame.collect { game ->
                _uiState.update { it.copy(isGameActive = (game != null && game.status == "PLAYING")) }
            }
        }

        viewModelScope.launch {
            repository.errorMessage.collect { errCode ->
                _uiState.update { it.copy(error = errCode, isLoading = false) }
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

        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(3500L)
                val active = _uiState.value.activeRoom
                val playing = _uiState.value.isGameActive
                if (active != null && !playing) {
                    repository.refreshActiveRoom()
                }
            }
        }

        refreshMyRooms()
    }

    fun refreshRoom() {
        viewModelScope.launch {
            repository.refreshActiveRoom()
        }
    }

    fun onRoomCodeChanged(code: String) {
        val filtered = code.uppercase().filter { it.isLetterOrDigit() }.take(6)
        _uiState.update { it.copy(roomCodeInput = filtered, error = null) }
    }

    fun createRoom(isPublic: Boolean = false, maxPlayers: Int = 4) {
        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = repository.createRoom(isPublic, maxPlayers)
            result.fold(
                onSuccess = { room ->
                    _uiState.update { it.copy(isLoading = false, activeRoom = room, error = null) }
                },
                onFailure = { ex ->
                    _uiState.update { it.copy(isLoading = false, error = ex.message ?: "Failed to create room") }
                }
            )
        }
    }

    fun quickPlay() {
        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = repository.quickPlay()
            result.fold(
                onSuccess = { room ->
                    _uiState.update { it.copy(isLoading = false, activeRoom = room, error = null) }
                },
                onFailure = { ex ->
                    _uiState.update { it.copy(isLoading = false, error = ex.message ?: "Failed to find match") }
                }
            )
        }
    }

    fun joinRoom(code: String = _uiState.value.roomCodeInput) {
        val trimmed = code.trim().uppercase()
        if (trimmed.length != 6) {
            _uiState.update { it.copy(error = "Room code must be 6 characters") }
            return
        }

        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = repository.joinRoom(trimmed)
            result.fold(
                onSuccess = { room ->
                    _uiState.update { it.copy(isLoading = false, activeRoom = room, roomCodeInput = "", error = null) }
                },
                onFailure = { ex ->
                    _uiState.update { it.copy(isLoading = false, error = ex.message ?: "Failed to join room") }
                }
            )
        }
    }

    fun leaveRoom() {
        repository.leaveRoom()
        _uiState.update { it.copy(activeRoom = null, isGameActive = false) }
        refreshMyRooms()
    }

    fun startGame() {
        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = repository.startRoom()
            result.fold(
                onSuccess = {
                    _uiState.update { it.copy(isLoading = false, error = null) }
                },
                onFailure = { ex ->
                    _uiState.update { it.copy(isLoading = false, error = ex.message ?: "Failed to start game") }
                }
            )
        }
    }

    fun refreshMyRooms() {
        viewModelScope.launch {
            repository.fetchMyRooms().onSuccess { rooms ->
                _uiState.update { it.copy(myRooms = rooms) }
            }
        }
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
        if (userId == _uiState.value.user?.id) return
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
                _uiState.update { it.copy(error = "Player blocked") }
            }
        }
    }

    fun unblockUser(userId: String) {
        viewModelScope.launch {
            val res = repository.unblockUser(userId)
            if (res.isSuccess) {
                _uiState.update { it.copy(error = "Player unblocked") }
            }
        }
    }

    fun reportUser(targetUserId: String, category: String, messageId: String? = null, reason: String? = null) {
        viewModelScope.launch {
            val roomCode = _uiState.value.activeRoom?.code
            val res = repository.reportUser(targetUserId, category, roomCode, messageId, reason)
            if (res.isSuccess) {
                _uiState.update { it.copy(error = "Report submitted successfully") }
            } else {
                _uiState.update { it.copy(error = "Failed to submit report") }
            }
        }
    }
}
