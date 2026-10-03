package com.j.uno.ui.game

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.GameEvent
import com.j.uno.model.PublicPlayerView
import com.j.uno.ui.theme.ChromaPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoundResultDialog(
    roundResult: GameEvent,
    myUserId: String,
    opponents: List<PublicPlayerView> = emptyList(),
    isHost: Boolean = false,
    onStartNextRound: () -> Unit = {},
    onDismissOrRematch: () -> Unit = {},
    onLeaveGame: () -> Unit = {}
) {
    val isWinner = (roundResult.winnerUserId == myUserId)
    val winnerPlayer = opponents.find { it.userId == roundResult.winnerUserId }
    val winnerDisplayName = when {
        isWinner -> "You"
        winnerPlayer != null -> winnerPlayer.displayName
        roundResult.winnerUserId != null -> "Player ${roundResult.winnerUserId.take(4)}"
        else -> "A player"
    }

    BasicAlertDialog(
        onDismissRequest = onDismissOrRematch
    ) {
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
            border = BorderStroke(1.5.dp, if (isWinner) ChromaPalette.Yellow else Color.White.copy(alpha = 0.2f)),
            modifier = Modifier.padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Trophy or star icon badge
                Box(
                    modifier = Modifier
                        .size(68.dp)
                        .clip(CircleShape)
                        .background(if (isWinner) ChromaPalette.Yellow else ChromaPalette.Wild)
                        .border(
                            2.dp,
                            if (isWinner) Color.White.copy(alpha = 0.8f) else Color.Transparent,
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (isWinner) "🏆" else "🎮",
                        fontSize = 34.sp
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = if (isWinner) "VICTORY!" else "ROUND OVER",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Black,
                    color = if (isWinner) ChromaPalette.Yellow else Color.White
                )

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = if (isWinner) {
                        "Congratulations! You played all your cards and won the round!"
                    } else {
                        "$winnerDisplayName emptied their hand first to take the win."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.85f),
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(18.dp))

                // Scores summary if available
                roundResult.scores?.let { scores ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "Score Summary (Hand Penalties)",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White.copy(alpha = 0.6f)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        scores.forEach { scoreItem ->
                            val playerId = scoreItem.userId
                            val score = scoreItem.handPoints
                            val isPlayerWinner = (playerId == roundResult.winnerUserId)
                            val name = when {
                                playerId == myUserId -> "You"
                                else -> opponents.find { it.userId == playerId }?.displayName ?: "Player (${playerId.take(4)})"
                            }

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (isPlayerWinner) {
                                        Text(text = "👑 ", fontSize = 12.sp)
                                    }
                                    Text(
                                        text = name,
                                        fontSize = 14.sp,
                                        fontWeight = if (playerId == myUserId || isPlayerWinner) FontWeight.Bold else FontWeight.Normal,
                                        color = if (isPlayerWinner) ChromaPalette.Yellow else Color.White
                                    )
                                }
                                if (isPlayerWinner) {
                                    Text(
                                        text = "0 pts (WIN)",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = ChromaPalette.Green
                                    )
                                } else {
                                    Text(
                                        text = "+$score pts",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = ChromaPalette.Yellow
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(20.dp))
                }

                // Action Buttons: Rematch / Next Round vs Leave Game
                if (isHost) {
                    Button(
                        onClick = onStartNextRound,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ChromaPalette.Yellow,
                            contentColor = ChromaPalette.Ink
                        )
                    ) {
                        Text(
                            text = "Start Next Round",
                            fontWeight = FontWeight.Black,
                            fontSize = 16.sp
                        )
                    }
                } else {
                    Button(
                        onClick = onDismissOrRematch,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ChromaPalette.Yellow,
                            contentColor = ChromaPalette.Ink
                        )
                    ) {
                        Text(
                            text = "Rematch (Wait for Host)",
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedButton(
                    onClick = onLeaveGame,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Color.White.copy(alpha = 0.8f)
                    ),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.25f))
                ) {
                    Text(
                        text = "Leave Game",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp
                    )
                }
            }
        }
    }
}
