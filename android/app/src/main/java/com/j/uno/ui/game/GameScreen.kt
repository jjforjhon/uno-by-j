package com.j.uno.ui.game

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import com.j.uno.ui.chat.ChatSheet
import com.j.uno.ui.chat.PlayerModerationDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.CardColor
import com.j.uno.model.PublicPlayerView
import com.j.uno.net.WsConnectionState
import com.j.uno.ui.theme.ChromaPalette

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun GameScreen(
    viewModel: GameViewModel,
    onLeaveGame: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val haptic = LocalHapticFeedback.current
    var showLeaveConfirmation by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.alertMessage) {
        uiState.alertMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.dismissAlert()
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = ChromaPalette.InkDeep,
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Top Header: Status, Opponents, Chat, and Leave
                GameTopHeader(
                    wsState = uiState.wsState,
                    opponents = uiState.opponents,
                    blockedUsers = uiState.blockedUsers,
                    pendingUnoOffenderId = uiState.pendingUnoOffenderId,
                    unreadChatCount = uiState.unreadChatCount,
                    onChatClicked = { viewModel.openChat() },
                    onCatchUno = { offenderId ->
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onCatchUnoClicked(offenderId)
                    },
                    onModerateOpponent = { userId, displayName -> viewModel.openModeration(userId, displayName) },
                    onLeaveClicked = { showLeaveConfirmation = true }
                )

                // Center Table: Discard Pile, Draw Pile, Turn Info & Timer
                GameCenterTable(
                    uiState = uiState,
                    onDrawClicked = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onDrawClicked()
                    }
                )

                // Bottom Section: Actions & Player Hand
                GameBottomSection(
                    uiState = uiState,
                    onCardClicked = { card ->
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onCardClicked(card)
                    },
                    onDrawClicked = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onDrawClicked()
                    },
                    onPassClicked = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onPassClicked()
                    },
                    onCallUnoClicked = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.onCallUnoClicked()
                    }
                )
            }

            // Inline Wild Color Selection Dialog
            if (uiState.pendingColorSelectionCard != null) {
                ColorPickerDialog(
                    onColorSelected = { color -> viewModel.onColorChosen(color) },
                    onDismiss = { viewModel.dismissColorPicker() }
                )
            }

            // Round End / Victory Dialog
            uiState.roundResult?.let { result ->
                RoundResultDialog(
                    roundResult = result,
                    myUserId = uiState.myUserId,
                    opponents = uiState.opponents,
                    isHost = uiState.isHost,
                    onStartNextRound = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.startNextRound()
                    },
                    onDismissOrRematch = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.dismissRoundResult()
                    },
                    onLeaveGame = {
                        viewModel.leaveGame()
                        onLeaveGame()
                    }
                )
            }

            // Leave Game Confirmation
            if (showLeaveConfirmation) {
                AlertDialog(
                    onDismissRequest = { showLeaveConfirmation = false },
                    title = { Text("Leave Game?", fontWeight = FontWeight.Bold) },
                    text = { Text("Leaving will return your cards to the draw pile. Other players will continue.") },
                    confirmButton = {
                        Button(
                            onClick = {
                                showLeaveConfirmation = false
                                viewModel.leaveGame()
                                onLeaveGame()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = ChromaPalette.Red)
                        ) {
                            Text("Leave", fontWeight = FontWeight.Bold)
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { showLeaveConfirmation = false }) {
                            Text("Stay", color = Color.White)
                        }
                    }
                )
            }

            // Chat Modal Bottom Sheet
            if (uiState.isChatOpen) {
                ChatSheet(
                    messages = uiState.chatMessages,
                    currentUserId = uiState.myUserId,
                    blockedUsers = uiState.blockedUsers,
                    onSendMessage = { viewModel.sendChatMessage(it) },
                    onDismiss = { viewModel.closeChat() },
                    onModerateUser = { userId, displayName, messageId ->
                        viewModel.openModeration(userId, displayName, messageId)
                    }
                )
            }

            // Player Moderation Dialog
            uiState.moderationTarget?.let { target ->
                PlayerModerationDialog(
                    target = target,
                    isBlocked = (target.userId in uiState.blockedUsers),
                    onBlockUser = { viewModel.blockUser(it) },
                    onUnblockUser = { viewModel.unblockUser(it) },
                    onReportUser = { targetUserId, category, messageId, reason ->
                        viewModel.reportUser(targetUserId, category, messageId, reason)
                    },
                    onDismiss = { viewModel.closeModeration() }
                )
            }
        }
    }
}

@Composable
private fun GameTopHeader(
    wsState: WsConnectionState,
    opponents: List<PublicPlayerView>,
    blockedUsers: Set<String>,
    pendingUnoOffenderId: String?,
    unreadChatCount: Int,
    onChatClicked: () -> Unit,
    onCatchUno: (String) -> Unit,
    onModerateOpponent: (userId: String, displayName: String) -> Unit,
    onLeaveClicked: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onLeaveClicked) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Leave Game",
                    tint = Color.White.copy(alpha = 0.8f)
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                // Chat button with unread count badge
                Box {
                    IconButton(onClick = onChatClicked) {
                        Icon(
                            imageVector = Icons.Default.ChatBubble,
                            contentDescription = "Open Chat",
                            tint = Color.White.copy(alpha = 0.9f)
                        )
                    }
                    if (unreadChatCount > 0) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(top = 4.dp, end = 4.dp)
                                .size(18.dp)
                                .clip(CircleShape)
                                .background(ChromaPalette.Red),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = if (unreadChatCount > 9) "9+" else unreadChatCount.toString(),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Black,
                                color = Color.White
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(4.dp))

                // WebSocket connection status pill
                ConnectionStatusPill(wsState = wsState)
            }
        }

        Spacer(modifier = Modifier.height(6.dp))

        // Opponents list (horizontal cards)
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(horizontal = 4.dp)
        ) {
            items(opponents, key = { it.userId }) { opponent ->
                OpponentCard(
                    opponent = opponent,
                    isOffender = (pendingUnoOffenderId == opponent.userId),
                    isBlocked = (opponent.userId in blockedUsers),
                    onCatchUno = { onCatchUno(opponent.userId) },
                    onModerate = { onModerateOpponent(opponent.userId, opponent.displayName) }
                )
            }
        }
    }
}

@Composable
private fun ConnectionStatusPill(wsState: WsConnectionState) {
    val (statusText, statusColor) = when (wsState) {
        is WsConnectionState.Connected -> "Online" to ChromaPalette.Green
        is WsConnectionState.Connecting -> "Connecting..." to ChromaPalette.Yellow
        is WsConnectionState.Authenticating -> "Authenticating..." to ChromaPalette.Yellow
        is WsConnectionState.Reconnecting -> "Reconnecting..." to ChromaPalette.Yellow
        is WsConnectionState.Disconnected -> "Offline" to ChromaPalette.Red
    }

    Row(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.1f), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(statusColor)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = statusText,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color.White
        )
    }
}

@Composable
private fun OpponentCard(
    opponent: PublicPlayerView,
    isOffender: Boolean,
    isBlocked: Boolean,
    onCatchUno: () -> Unit,
    onModerate: () -> Unit
) {
    val cardBorder = when {
        isOffender -> BorderStroke(2.dp, ChromaPalette.Red)
        isBlocked -> BorderStroke(1.dp, ChromaPalette.Red.copy(alpha = 0.6f))
        else -> BorderStroke(1.dp, Color.White.copy(alpha = 0.15f))
    }

    Card(
        shape = RoundedCornerShape(12.dp),
        border = cardBorder,
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        modifier = Modifier
            .width(115.dp)
            .clickable { onModerate() }
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Player name with shield icon
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = opponent.displayName,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(modifier = Modifier.width(3.dp))
                Icon(
                    imageVector = Icons.Default.Shield,
                    contentDescription = "Player Options",
                    tint = if (isBlocked) ChromaPalette.Red else Color.White.copy(alpha = 0.35f),
                    modifier = Modifier.size(11.dp)
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Blocked Indicator or Card count badge
            if (isBlocked) {
                Box(
                    modifier = Modifier
                        .background(ChromaPalette.Red.copy(alpha = 0.2f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "BLOCKED",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Black,
                        color = ChromaPalette.Red
                    )
                }
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .background(Color.White.copy(alpha = 0.1f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "🂠 ${opponent.cardCount}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = ChromaPalette.Yellow
                    )
                }
            }

            // UNO call indicator if 1 card left
            if (opponent.cardCount == 1) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "UNO!",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Black,
                    color = ChromaPalette.Red
                )
            }

            // Catch UNO Button if offender
            if (isOffender) {
                Spacer(modifier = Modifier.height(4.dp))
                Button(
                    onClick = onCatchUno,
                    modifier = Modifier.fillMaxWidth().height(26.dp),
                    contentPadding = PaddingValues(0.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = ChromaPalette.Red),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = "CATCH!",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun GameCenterTable(
    uiState: GameUiState,
    onDrawClicked: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF141A30)),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.08f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Direction & Turn indicator banner
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (uiState.direction == 1) "↻ Clockwise" else "↺ Counter-Clockwise",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color.White.copy(alpha = 0.6f)
                )

                Text(
                    text = if (uiState.isMyTurn) "👉 YOUR TURN" else "⏳ Waiting...",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                    color = if (uiState.isMyTurn) ChromaPalette.Yellow else Color.White.copy(alpha = 0.7f)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // The Two Piles: Draw Deck & Discard Pile
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Draw Pile (clickable if it's your turn)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    UnoCardBackView(
                        cardWidth = 74.dp,
                        cardHeight = 110.dp,
                        countBadge = uiState.drawPileCount,
                        isClickable = uiState.isMyTurn,
                        onClick = onDrawClicked
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (uiState.isMyTurn) "Tap to Draw" else "Draw Pile",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (uiState.isMyTurn) ChromaPalette.Yellow else Color.White.copy(alpha = 0.6f)
                    )
                }

                Spacer(modifier = Modifier.width(32.dp))

                // Discard Pile (Top Card)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (uiState.topCard != null) {
                        UnoCardView(
                            card = uiState.topCard,
                            cardWidth = 74.dp,
                            cardHeight = 110.dp,
                            isPlayable = false
                        )
                    } else {
                        Box(
                            modifier = Modifier
                                .size(width = 74.dp, height = 110.dp)
                                .border(1.dp, Color.White.copy(alpha = 0.3f), RoundedCornerShape(10.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("Empty", color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp)
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    // Active color badge if wild card is on top
                    uiState.activeColor?.let { color ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(cardColorToComposeColor(color))
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "Color: ${color.name}",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun GameBottomSection(
    uiState: GameUiState,
    onCardClicked: (com.j.uno.model.UnoCard) -> Unit,
    onDrawClicked: () -> Unit,
    onPassClicked: () -> Unit,
    onCallUnoClicked: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        // Action Controls Bar: Draw, Pass, UNO!
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Draw Button
            Button(
                onClick = onDrawClicked,
                enabled = uiState.isMyTurn,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White.copy(alpha = 0.15f),
                    contentColor = Color.White,
                    disabledContainerColor = Color.White.copy(alpha = 0.05f),
                    disabledContentColor = Color.White.copy(alpha = 0.3f)
                ),
                modifier = Modifier.weight(1f).height(40.dp)
            ) {
                Text("Draw", fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Pass Button (enabled only when player has drawn a playable card and can pass)
            AnimatedVisibility(visible = uiState.canPass) {
                Row {
                    Button(
                        onClick = onPassClicked,
                        enabled = uiState.isMyTurn && uiState.canPass,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ChromaPalette.Blue,
                            contentColor = Color.White
                        ),
                        modifier = Modifier.height(40.dp)
                    ) {
                        Text("Pass Turn", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                }
            }

            // UNO! Button with pulse animation when hand count <= 2
            val infiniteTransition = rememberInfiniteTransition(label = "unoPulse")
            val unoPulseScale by infiniteTransition.animateFloat(
                initialValue = 1f,
                targetValue = if (uiState.myHand.size <= 2) 1.08f else 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(durationMillis = 600),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "pulseScale"
            )

            Button(
                onClick = onCallUnoClicked,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (uiState.myHand.size <= 2) ChromaPalette.Yellow else Color.White.copy(alpha = 0.2f),
                    contentColor = if (uiState.myHand.size <= 2) ChromaPalette.Ink else Color.White
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(40.dp)
                    .scale(unoPulseScale)
            ) {
                Text("UNO!", fontWeight = FontWeight.Black, fontSize = 14.sp)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Hand count label
        Text(
            text = "Your Hand (${uiState.myHand.size} cards)",
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color.White.copy(alpha = 0.7f),
            modifier = Modifier.padding(start = 6.dp, bottom = 4.dp)
        )

        // Hand Cards Row
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .height(115.dp),
            horizontalArrangement = Arrangement.spacedBy((-16).dp), // overlapping cards for natural hand feel
            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
        ) {
            items(uiState.myHand, key = { it.id }) { card ->
                val isPlayable = uiState.isMyTurn && (card.id in uiState.playableCardIds)
                UnoCardView(
                    card = card,
                    isPlayable = isPlayable,
                    onClick = { onCardClicked(card) },
                    cardWidth = 66.dp,
                    cardHeight = 98.dp
                )
            }
        }
    }
}
