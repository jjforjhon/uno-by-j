package com.j.uno

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.j.uno.ui.auth.AuthScreen
import com.j.uno.ui.auth.AuthViewModel
import com.j.uno.ui.game.GameScreen
import com.j.uno.ui.game.GameViewModel
import com.j.uno.ui.lobby.LobbyScreen
import com.j.uno.ui.lobby.LobbyViewModel
import com.j.uno.ui.theme.ChromaPalette
import com.j.uno.ui.theme.UnoTheme
import dagger.hilt.android.AndroidEntryPoint

enum class AppDestination {
    AUTH,
    LOBBY,
    GAME
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()
    private val lobbyViewModel: LobbyViewModel by viewModels()
    private val gameViewModel: GameViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            UnoTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = ChromaPalette.InkDeep
                ) {
                    UnoAppNavHost(
                        authViewModel = authViewModel,
                        lobbyViewModel = lobbyViewModel,
                        gameViewModel = gameViewModel
                    )
                }
            }
        }
    }
}

@Composable
fun UnoAppNavHost(
    authViewModel: AuthViewModel,
    lobbyViewModel: LobbyViewModel,
    gameViewModel: GameViewModel,
    modifier: Modifier = Modifier
) {
    val authState by authViewModel.uiState.collectAsState()
    val lobbyState by lobbyViewModel.uiState.collectAsState()
    val gameState by gameViewModel.uiState.collectAsState()

    val currentDestination = when {
        !authState.isAuthenticated -> AppDestination.AUTH
        gameState.topCard != null || lobbyState.isGameActive -> AppDestination.GAME
        else -> AppDestination.LOBBY
    }

    Crossfade(
        targetState = currentDestination,
        label = "appNavigation",
        modifier = modifier.fillMaxSize()
    ) { destination ->
        when (destination) {
            AppDestination.AUTH -> {
                AuthScreen(
                    viewModel = authViewModel,
                    onAuthSuccess = {
                        lobbyViewModel.refreshMyRooms()
                    }
                )
            }
            AppDestination.LOBBY -> {
                BackHandler(enabled = lobbyState.activeRoom != null) {
                    lobbyViewModel.leaveRoom()
                }

                LobbyScreen(
                    viewModel = lobbyViewModel,
                    onLogout = {
                        authViewModel.logout()
                    },
                    onGameStarted = {
                        // Game start transitions automatically when isGameActive is true
                    }
                )
            }
            AppDestination.GAME -> {
                BackHandler(enabled = true) {
                    gameViewModel.leaveGame()
                    lobbyViewModel.leaveRoom()
                }

                GameScreen(
                    viewModel = gameViewModel,
                    onLeaveGame = {
                        lobbyViewModel.leaveRoom()
                    }
                )
            }
        }
    }
}
