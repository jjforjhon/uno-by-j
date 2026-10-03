package com.j.uno.ui.game

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.BasicAlertDialog
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.CardColor
import com.j.uno.ui.theme.ChromaPalette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ColorPickerDialog(
    onColorSelected: (CardColor) -> Unit,
    onDismiss: () -> Unit
) {
    BasicAlertDialog(
        onDismissRequest = onDismiss
    ) {
        Card(
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
            modifier = Modifier.padding(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "Select Next Color",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = "Choose the color for the discard pile",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.7f)
                )

                Spacer(modifier = Modifier.height(20.dp))

                // 2x2 Grid of Colors
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    ColorSelectionTile(
                        color = CardColor.R,
                        label = "RED",
                        displayColor = ChromaPalette.Red,
                        onClick = { onColorSelected(CardColor.R) }
                    )
                    ColorSelectionTile(
                        color = CardColor.B,
                        label = "BLUE",
                        displayColor = ChromaPalette.Blue,
                        onClick = { onColorSelected(CardColor.B) }
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    ColorSelectionTile(
                        color = CardColor.Y,
                        label = "YELLOW",
                        displayColor = ChromaPalette.Yellow,
                        onClick = { onColorSelected(CardColor.Y) }
                    )
                    ColorSelectionTile(
                        color = CardColor.G,
                        label = "GREEN",
                        displayColor = ChromaPalette.Green,
                        onClick = { onColorSelected(CardColor.G) }
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                OutlinedButton(
                    onClick = onDismiss,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White.copy(alpha = 0.8f))
                ) {
                    Text("Cancel (Keep Card)")
                }
            }
        }
    }
}

@Composable
private fun ColorSelectionTile(
    color: CardColor,
    label: String,
    displayColor: Color,
    onClick: () -> Unit
) {
    val haptic = LocalHapticFeedback.current
    Box(
        modifier = Modifier
            .size(width = 110.dp, height = 80.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(displayColor)
            .clickable {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onClick()
            }
            .padding(8.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = label,
                fontSize = 16.sp,
                fontWeight = FontWeight.Black,
                color = if (color == CardColor.Y) Color.Black else Color.White
            )
            Text(
                text = "[${cardColorSymbol(color)}]",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (color == CardColor.Y) Color.Black.copy(alpha = 0.7f) else Color.White.copy(alpha = 0.8f)
            )
        }
    }
}
