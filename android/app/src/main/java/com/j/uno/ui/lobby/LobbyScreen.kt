package com.j.uno.ui.lobby

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import com.j.uno.ui.chat.ChatSheet
import com.j.uno.ui.chat.PlayerModerationDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.RoomView
import com.j.uno.ui.theme.ChromaPalette

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    viewModel: LobbyViewModel,
    onLogout: () -> Unit,
    onGameStarted: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.isGameActive) {
        if (uiState.isGameActive) {
            onGameStarted()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { err ->
            snackbarHostState.showSnackbar(err)
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
            val activeRoom = uiState.activeRoom
            if (activeRoom == null) {
                MainLobbyContent(
                    viewModel = viewModel,
                    uiState = uiState,
                    onLogout = onLogout
                )
            } else {
                RoomWaitingLobbyContent(
                    viewModel = viewModel,
                    room = activeRoom,
                    currentUserId = uiState.user?.id.orEmpty(),
                    blockedUsers = uiState.blockedUsers,
                    unreadChatCount = uiState.unreadChatCount,
                    isLoading = uiState.isLoading
                )
            }

            // Chat Modal Bottom Sheet
            if (uiState.isChatOpen) {
                ChatSheet(
                    messages = uiState.chatMessages,
                    currentUserId = uiState.user?.id.orEmpty(),
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
private fun MainLobbyContent(
    viewModel: LobbyViewModel,
    uiState: LobbyUiState,
    onLogout: () -> Unit
) {
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // User Profile Bar
        UserProfileHeader(
            userName = uiState.user?.displayName ?: "Guest",
            userId = uiState.user?.id ?: "",
            onLogout = onLogout
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Quick Play Card
        QuickPlayCard(
            isLoading = uiState.isLoading,
            onQuickPlay = { viewModel.quickPlay() }
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Create Room Card
        CreateRoomCard(
            isLoading = uiState.isLoading,
            onCreateRoom = { isPublic, maxPlayers ->
                viewModel.createRoom(isPublic, maxPlayers)
            }
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Join with Code Card
        JoinRoomCard(
            code = uiState.roomCodeInput,
            onCodeChanged = { viewModel.onRoomCodeChanged(it) },
            isLoading = uiState.isLoading,
            onJoin = { viewModel.joinRoom() }
        )

        // My Active Rooms
        if (uiState.myRooms.isNotEmpty()) {
            Spacer(modifier = Modifier.height(16.dp))
            MyRoomsCard(
                rooms = uiState.myRooms,
                onRejoin = { roomCode -> viewModel.joinRoom(roomCode) }
            )
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun UserProfileHeader(
    userName: String,
    userId: String,
    onLogout: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(ChromaPalette.Yellow),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = userName.take(1).uppercase(),
                        fontWeight = FontWeight.Black,
                        fontSize = 20.sp,
                        color = ChromaPalette.Ink
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                Column {
                    Text(
                        text = userName,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = Color.White
                    )
                    Text(
                        text = "ID: ${userId.take(8)}",
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.5f)
                    )
                }
            }

            IconButton(onClick = onLogout) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                    contentDescription = "Log Out",
                    tint = Color.White.copy(alpha = 0.7f)
                )
            }
        }
    }
}

@Composable
private fun QuickPlayCard(
    isLoading: Boolean,
    onQuickPlay: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        border = BorderStroke(1.5.dp, ChromaPalette.Yellow.copy(alpha = 0.4f))
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.FlashOn,
                    contentDescription = null,
                    tint = ChromaPalette.Yellow,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Quick Match",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = "Instant matchmaking with online players in public rooms.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f)
            )

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = onQuickPlay,
                enabled = !isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ChromaPalette.Yellow,
                    contentColor = ChromaPalette.Ink
                )
            ) {
                if (isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = ChromaPalette.Ink)
                } else {
                    Text("Play Now", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                }
            }
        }
    }
}

@Composable
private fun CreateRoomCard(
    isLoading: Boolean,
    onCreateRoom: (isPublic: Boolean, maxPlayers: Int) -> Unit
) {
    var maxPlayers by remember { mutableIntStateOf(4) }
    var isPublic by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = null,
                    tint = ChromaPalette.Green,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Create Room",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Player count selection
            Text(
                text = "Max Players",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color.White.copy(alpha = 0.8f)
            )
            Spacer(modifier = Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(2, 3, 4).forEach { count ->
                    FilterChip(
                        selected = (maxPlayers == count),
                        onClick = { maxPlayers = count },
                        label = { Text("$count Players") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = ChromaPalette.Green,
                            selectedLabelColor = Color.White,
                            containerColor = Color.White.copy(alpha = 0.08f),
                            labelColor = Color.White.copy(alpha = 0.8f)
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Public / Private Switch
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = if (isPublic) "Public Room" else "Private Room",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Text(
                        text = if (isPublic) "Anyone can match into this room" else "Players must have the room code",
                        fontSize = 11.sp,
                        color = Color.White.copy(alpha = 0.6f)
                    )
                }

                Switch(
                    checked = isPublic,
                    onCheckedChange = { isPublic = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = ChromaPalette.Green,
                        checkedTrackColor = ChromaPalette.Green.copy(alpha = 0.5f)
                    )
                )
            }

            Spacer(modifier = Modifier.height(18.dp))

            Button(
                onClick = { onCreateRoom(isPublic, maxPlayers) },
                enabled = !isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ChromaPalette.Green,
                    contentColor = Color.White
                )
            ) {
                Text("Create Room", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun JoinRoomCard(
    code: String,
    onCodeChanged: (String) -> Unit,
    isLoading: Boolean,
    onJoin: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = null,
                    tint = ChromaPalette.Blue,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Join with Code",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            OutlinedTextField(
                value = code,
                onValueChange = onCodeChanged,
                placeholder = { Text("e.g. ABC123") },
                label = { Text("6-Character Room Code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = {
                    if (code.length == 6 && !isLoading) onJoin()
                }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = ChromaPalette.Blue,
                    unfocusedBorderColor = Color.White.copy(alpha = 0.3f),
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White
                ),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp)
            )

            Spacer(modifier = Modifier.height(14.dp))

            Button(
                onClick = onJoin,
                enabled = !isLoading && code.length == 6,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = ChromaPalette.Blue,
                    contentColor = Color.White,
                    disabledContainerColor = ChromaPalette.Blue.copy(alpha = 0.3f)
                )
            ) {
                Text("Join Room", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun MyRoomsCard(
    rooms: List<RoomView>,
    onRejoin: (String) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                text = "Your Active Rooms",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(10.dp))

            rooms.forEach { room ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp)
                        .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Code: ${room.code}",
                            fontWeight = FontWeight.Bold,
                            color = ChromaPalette.Yellow,
                            fontSize = 15.sp
                        )
                        Text(
                            text = "${room.members.size}/${room.maxPlayers} players",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.6f)
                        )
                    }

                    OutlinedButton(
                        onClick = { onRejoin(room.code) },
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Rejoin")
                    }
                }
            }
        }
    }
}

@Composable
private fun RoomWaitingLobbyContent(
    viewModel: LobbyViewModel,
    room: RoomView,
    currentUserId: String,
    blockedUsers: Set<String>,
    unreadChatCount: Int,
    isLoading: Boolean
) {
    val clipboardManager = LocalClipboardManager.current
    var copiedNotice by remember { mutableStateOf(false) }
    val isHost = (room.hostUserId == currentUserId)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Room Code Header
            Text(
                text = "ROOM LOBBY",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = ChromaPalette.Yellow,
                letterSpacing = 2.sp
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Large Room Code Banner
            Row(
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
                    .clickable {
                        clipboardManager.setText(AnnotatedString(room.code))
                        copiedNotice = true
                    }
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = room.code,
                    fontSize = 36.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White,
                    letterSpacing = 4.sp
                )

                Spacer(modifier = Modifier.width(12.dp))

                Icon(
                    imageVector = Icons.Default.ContentCopy,
                    contentDescription = "Copy Code",
                    tint = ChromaPalette.Yellow,
                    modifier = Modifier.size(24.dp)
                )
            }

            if (copiedNotice) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Room code copied to clipboard!",
                    fontSize = 12.sp,
                    color = ChromaPalette.Green,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Sub-bar with room type and Open Chat button
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "${if (room.isPublic) "Public" else "Private"} Room • ${room.members.size}/${room.maxPlayers} Players",
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.7f)
                )

                // Chat button with badge
                OutlinedButton(
                    onClick = { viewModel.openChat() },
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, ChromaPalette.Yellow.copy(alpha = 0.6f)),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    modifier = Modifier.height(34.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ChatBubble,
                        contentDescription = null,
                        tint = ChromaPalette.Yellow,
                        modifier = Modifier.size(15.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Chat", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    if (unreadChatCount > 0) {
                        Spacer(modifier = Modifier.width(6.dp))
                        Box(
                            modifier = Modifier
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
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Player Slots
            Text(
                text = "Players in Room (tap to view player options)",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.align(Alignment.Start)
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Joined Members
            room.members.forEach { member ->
                val isSelf = (member.userId == currentUserId)
                val isBlocked = (member.userId in blockedUsers)

                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .clickable(enabled = !isSelf) {
                            viewModel.openModeration(member.userId, member.displayName)
                        },
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
                    border = when {
                        isBlocked -> BorderStroke(1.dp, ChromaPalette.Red.copy(alpha = 0.6f))
                        else -> BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
                    }
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(if (isBlocked) ChromaPalette.Red else ChromaPalette.Blue),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = member.displayName.take(1).uppercase(),
                                    fontWeight = FontWeight.Black,
                                    color = Color.White
                                )
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = member.displayName + if (isSelf) " (You)" else "",
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White,
                                        fontSize = 15.sp
                                    )
                                    if (!isSelf) {
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Icon(
                                            imageVector = Icons.Default.Shield,
                                            contentDescription = "Options",
                                            tint = if (isBlocked) ChromaPalette.Red else Color.White.copy(alpha = 0.35f),
                                            modifier = Modifier.size(13.dp)
                                        )
                                    }
                                }
                                if (isBlocked) {
                                    Text(
                                        text = "Blocked player",
                                        fontSize = 10.sp,
                                        color = ChromaPalette.Red,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }

                        if (member.role == "host" || member.userId == room.hostUserId) {
                            Box(
                                modifier = Modifier
                                    .background(ChromaPalette.Yellow, RoundedCornerShape(6.dp))
                                    .padding(horizontal = 8.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = "HOST",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Black,
                                    color = ChromaPalette.Ink
                                )
                            }
                        } else if (isBlocked) {
                            Box(
                                modifier = Modifier
                                    .background(ChromaPalette.Red.copy(alpha = 0.2f), RoundedCornerShape(6.dp))
                                    .padding(horizontal = 8.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = "BLOCKED",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Black,
                                    color = ChromaPalette.Red
                                )
                            }
                        } else {
                            Text(
                                text = "Ready",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = ChromaPalette.Green
                            )
                        }
                    }
                }
            }

            // Empty Slots
            val emptySlots = room.maxPlayers - room.members.size
            repeat(emptySlots) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .background(Color.White.copy(alpha = 0.04f), RoundedCornerShape(12.dp))
                        .padding(14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Waiting for player to join...",
                        fontSize = 13.sp,
                        color = Color.White.copy(alpha = 0.4f)
                    )
                }
            }
        }

        // Bottom Controls: Start Game (Host only) & Leave Room
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (isHost) {
                val canStart = room.members.size >= 2
                Button(
                    onClick = { viewModel.startGame() },
                    enabled = canStart && !isLoading,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = ChromaPalette.Yellow,
                        contentColor = ChromaPalette.Ink,
                        disabledContainerColor = ChromaPalette.Yellow.copy(alpha = 0.3f),
                        disabledContentColor = ChromaPalette.Ink.copy(alpha = 0.5f)
                    )
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = ChromaPalette.Ink)
                    } else {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Start Game", fontWeight = FontWeight.Black, fontSize = 17.sp)
                        }
                    }
                }

                if (!canStart) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Need at least 2 players to start game",
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.6f)
                    )
                }
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(12.dp))
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = ChromaPalette.Yellow,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Waiting for host to start the game...",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color.White
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedButton(
                onClick = { viewModel.leaveRoom() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = ChromaPalette.Red
                ),
                border = BorderStroke(1.dp, ChromaPalette.Red.copy(alpha = 0.5f))
            ) {
                Text("Leave Room", fontWeight = FontWeight.Bold)
            }
        }
    }
}
