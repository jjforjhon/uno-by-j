package com.j.uno.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.ChatMessageDto
import com.j.uno.ui.theme.ChromaPalette
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class ModerationTarget(
    val userId: String,
    val displayName: String,
    val messageId: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatSheet(
    messages: List<ChatMessageDto>,
    currentUserId: String,
    blockedUsers: Set<String>,
    onSendMessage: (String) -> Unit,
    onDismiss: () -> Unit,
    onModerateUser: (userId: String, displayName: String, messageId: String?) -> Unit,
    modifier: Modifier = Modifier
) {
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val visibleMessages = remember(messages, blockedUsers) {
        messages.filter { it.senderUserId !in blockedUsers }
    }

    LaunchedEffect(visibleMessages.size) {
        if (visibleMessages.isNotEmpty()) {
            listState.animateScrollToItem(visibleMessages.size - 1)
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color(0xFF141A30),
        tonalElevation = 8.dp,
        modifier = modifier
            .fillMaxWidth()
            .imePadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.75f)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "💬 Room Chat",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "(${visibleMessages.size} msgs)",
                        fontSize = 12.sp,
                        color = Color.White.copy(alpha = 0.5f)
                    )
                }

                IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Close Chat",
                        tint = Color.White.copy(alpha = 0.7f)
                    )
                }
            }

            // Message List
            if (visibleMessages.isEmpty()) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "No messages yet",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White.copy(alpha = 0.6f)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Say hello to everyone in the room!",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.4f)
                        )
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 4.dp)
                ) {
                    items(visibleMessages, key = { it.id }) { msg ->
                        val isSelf = (msg.senderUserId == currentUserId)
                        ChatMessageBubble(
                            msg = msg,
                            isSelf = isSelf,
                            onModerateSender = {
                                if (!isSelf) {
                                    onModerateUser(msg.senderUserId, msg.senderDisplayName, msg.id)
                                }
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Input Row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = {
                        if (it.length <= 280) inputText = it
                    },
                    placeholder = {
                        Text(
                            "Type a message... (max 280)",
                            fontSize = 13.sp,
                            color = Color.White.copy(alpha = 0.4f)
                        )
                    },
                    singleLine = false,
                    maxLines = 3,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val trimmed = inputText.trim()
                        if (trimmed.isNotBlank()) {
                            onSendMessage(trimmed)
                            inputText = ""
                        }
                    }),
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(20.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = ChromaPalette.Yellow,
                        unfocusedBorderColor = Color.White.copy(alpha = 0.2f),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color.White.copy(alpha = 0.05f),
                        unfocusedContainerColor = Color.White.copy(alpha = 0.05f)
                    )
                )

                Spacer(modifier = Modifier.width(8.dp))

                IconButton(
                    onClick = {
                        val trimmed = inputText.trim()
                        if (trimmed.isNotBlank()) {
                            onSendMessage(trimmed)
                            inputText = ""
                        }
                    },
                    enabled = inputText.trim().isNotBlank(),
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(
                            if (inputText.trim().isNotBlank()) ChromaPalette.Yellow
                            else Color.White.copy(alpha = 0.1f)
                        )
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (inputText.trim().isNotBlank()) ChromaPalette.Ink else Color.White.copy(alpha = 0.3f),
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatMessageBubble(
    msg: ChatMessageDto,
    isSelf: Boolean,
    onModerateSender: () -> Unit
) {
    val align = if (isSelf) Alignment.End else Alignment.Start
    val bubbleColor = if (isSelf) ChromaPalette.Blue.copy(alpha = 0.35f) else Color.White.copy(alpha = 0.08f)
    val borderColor = if (isSelf) ChromaPalette.Blue.copy(alpha = 0.6f) else Color.White.copy(alpha = 0.12f)
    val timeFormatted = remember(msg.createdAt) {
        try {
            val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
            sdf.format(Date(msg.createdAt))
        } catch (_: Exception) {
            ""
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = align
    ) {
        // Sender header row
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
        ) {
            if (!isSelf) {
                Text(
                    text = msg.senderDisplayName,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = ChromaPalette.Yellow,
                    modifier = Modifier.clickable { onModerateSender() }
                )
                Spacer(modifier = Modifier.width(4.dp))
                Icon(
                    imageVector = Icons.Default.Flag,
                    contentDescription = "Report/Block",
                    tint = Color.White.copy(alpha = 0.4f),
                    modifier = Modifier
                        .size(12.dp)
                        .clickable { onModerateSender() }
                )
                Spacer(modifier = Modifier.width(6.dp))
            } else {
                Text(
                    text = "You",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White.copy(alpha = 0.6f)
                )
                Spacer(modifier = Modifier.width(6.dp))
            }

            Text(
                text = timeFormatted,
                fontSize = 10.sp,
                color = Color.White.copy(alpha = 0.4f)
            )
        }

        // Message text container
        Card(
            shape = RoundedCornerShape(
                topStart = 14.dp,
                topEnd = 14.dp,
                bottomStart = if (isSelf) 14.dp else 2.dp,
                bottomEnd = if (isSelf) 2.dp else 14.dp
            ),
            colors = CardDefaults.cardColors(containerColor = bubbleColor),
            border = BorderStroke(1.dp, borderColor),
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            Text(
                text = msg.body,
                color = Color.White,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlayerModerationDialog(
    target: ModerationTarget,
    isBlocked: Boolean,
    onBlockUser: (String) -> Unit,
    onUnblockUser: (String) -> Unit,
    onReportUser: (targetUserId: String, category: String, messageId: String?, reason: String?) -> Unit,
    onDismiss: () -> Unit
) {
    var isReportingMode by remember { mutableStateOf(false) }
    var selectedCategory by remember { mutableStateOf("HARASSMENT") }
    var reportReason by remember { mutableStateOf("") }
    var reportSubmitted by remember { mutableStateOf(false) }

    val categories = listOf(
        "HARASSMENT" to "Harassment",
        "SPAM" to "Spam",
        "INAPPROPRIATE_NAME" to "Bad Name",
        "CHEATING" to "Cheating",
        "OTHER" to "Other"
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF141A30),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Shield,
                    contentDescription = null,
                    tint = ChromaPalette.Yellow,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (isReportingMode) "Report Player" else "Player Options",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = Color.White
                )
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                // Player overview row
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White.copy(alpha = 0.05f), RoundedCornerShape(10.dp))
                        .padding(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(ChromaPalette.Blue),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = target.displayName.take(1).uppercase(),
                            fontWeight = FontWeight.Black,
                            color = Color.White
                        )
                    }

                    Spacer(modifier = Modifier.width(10.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = target.displayName,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = "ID: ${target.userId.take(10)}...",
                            fontSize = 11.sp,
                            color = Color.White.copy(alpha = 0.5f)
                        )
                    }

                    // Status Badge
                    if (isBlocked) {
                        Box(
                            modifier = Modifier
                                .background(ChromaPalette.Red.copy(alpha = 0.2f), RoundedCornerShape(6.dp))
                                .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Text(
                                text = "BLOCKED",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Black,
                                color = ChromaPalette.Red
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                if (reportSubmitted) {
                    // Success acknowledgment
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(ChromaPalette.Green.copy(alpha = 0.15f), RoundedCornerShape(8.dp))
                            .padding(12.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "✓ Report submitted successfully. Thank you for keeping UNO safe!",
                            fontSize = 13.sp,
                            color = ChromaPalette.Green,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center
                        )
                    }
                } else if (!isReportingMode) {
                    // Standard Options Mode: Block/Unblock & Open Report
                    if (isBlocked) {
                        Text(
                            text = "This player is currently blocked. You will not see their chat messages, and matchmaking will avoid placing you together.",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.7f),
                            lineHeight = 16.sp
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = { onUnblockUser(target.userId) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = ChromaPalette.Green),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Unblock Player", fontWeight = FontWeight.Bold)
                        }
                    } else {
                        Text(
                            text = "Blocking will immediately hide this player's chat messages and prevent future quick-play pairing with them.",
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.7f),
                            lineHeight = 16.sp
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = { onBlockUser(target.userId) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = ChromaPalette.Red),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.Block, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Block Player", fontWeight = FontWeight.Bold)
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    OutlinedButton(
                        onClick = { isReportingMode = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, Color.White.copy(alpha = 0.3f))
                    ) {
                        Icon(Icons.Default.Flag, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Report Violation...", color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                } else {
                    // Reporting Mode
                    Text(
                        text = "Select violation category:",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White.copy(alpha = 0.8f)
                    )
                    Spacer(modifier = Modifier.height(6.dp))

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        categories.forEach { (catKey, catLabel) ->
                            FilterChip(
                                selected = (selectedCategory == catKey),
                                onClick = { selectedCategory = catKey },
                                label = { Text(catLabel, fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = ChromaPalette.Yellow,
                                    selectedLabelColor = ChromaPalette.Ink,
                                    containerColor = Color.White.copy(alpha = 0.08f),
                                    labelColor = Color.White.copy(alpha = 0.8f)
                                )
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    OutlinedTextField(
                        value = reportReason,
                        onValueChange = { if (it.length <= 200) reportReason = it },
                        placeholder = { Text("Describe the issue (optional)", fontSize = 12.sp, color = Color.White.copy(alpha = 0.4f)) },
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = ChromaPalette.Yellow,
                            unfocusedBorderColor = Color.White.copy(alpha = 0.2f),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = {
                            onReportUser(
                                target.userId,
                                selectedCategory,
                                target.messageId,
                                reportReason.ifBlank { null }
                            )
                            reportSubmitted = true
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = ChromaPalette.Yellow, contentColor = ChromaPalette.Ink),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Submit Report", fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    TextButton(
                        onClick = { isReportingMode = false },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Back to Player Options", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close", color = Color.White.copy(alpha = 0.8f))
            }
        }
    )
}
