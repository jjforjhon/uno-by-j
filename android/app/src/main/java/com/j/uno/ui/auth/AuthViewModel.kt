package com.j.uno.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.j.uno.data.GameRepository
import com.j.uno.model.UserDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val displayName: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val user: UserDto? = null,
    val isAuthenticated: Boolean = false
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val repository: GameRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        checkSession()
        viewModelScope.launch {
            repository.currentUser.collect { user ->
                _uiState.update {
                    it.copy(
                        user = user,
                        isAuthenticated = (user != null)
                    )
                }
            }
        }
    }

    fun onDisplayNameChanged(name: String) {
        _uiState.update { it.copy(displayName = name, error = null) }
    }

    fun checkSession() {
        val hasSession = repository.restoreSession()
        _uiState.update {
            it.copy(
                user = repository.currentUser.value,
                isAuthenticated = hasSession
            )
        }
    }

    fun signInAsGuest() {
        val name = _uiState.value.displayName.trim()
        if (name.length < 2) {
            _uiState.update { it.copy(error = "Display name must be at least 2 characters") }
            return
        }

        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            val result = repository.loginAsGuest(name)
            result.fold(
                onSuccess = { user ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            user = user,
                            isAuthenticated = true,
                            error = null
                        )
                    }
                },
                onFailure = { ex ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = ex.message ?: "Authentication failed"
                        )
                    }
                }
            )
        }
    }

    fun logout() {
        repository.logout()
        _uiState.update { AuthUiState() }
    }
}
