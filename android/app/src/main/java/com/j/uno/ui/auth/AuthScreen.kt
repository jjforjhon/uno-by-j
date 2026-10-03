package com.j.uno.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.ui.theme.ChromaPalette

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onAuthSuccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    // If authenticated, notify parent
    if (uiState.isAuthenticated) {
        onAuthSuccess()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = ChromaPalette.InkDeep
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Brand Logo & Title
            BrandHeader()

            Spacer(modifier = Modifier.height(36.dp))

            // Guest Login Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = ChromaPalette.Ink),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.1f))
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Guest Player Sign-In",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Jump straight in! Your identity will be securely saved on this device.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    OutlinedTextField(
                        value = uiState.displayName,
                        onValueChange = { viewModel.onDisplayNameChanged(it) },
                        label = { Text("Display Name") },
                        placeholder = { Text("e.g. AcePlayer") },
                        singleLine = true,
                        isError = uiState.error != null,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            if (uiState.displayName.trim().length >= 2 && !uiState.isLoading) {
                                viewModel.signInAsGuest()
                            }
                        }),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = ChromaPalette.Yellow,
                            unfocusedBorderColor = Color.White.copy(alpha = 0.3f),
                            focusedLabelColor = ChromaPalette.Yellow,
                            unfocusedLabelColor = Color.White.copy(alpha = 0.6f),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )

                    if (uiState.error != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = uiState.error ?: "",
                            color = ChromaPalette.Red,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Start,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = { viewModel.signInAsGuest() },
                        enabled = !uiState.isLoading && uiState.displayName.trim().length >= 2,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = ChromaPalette.Yellow,
                            contentColor = ChromaPalette.Ink,
                            disabledContainerColor = ChromaPalette.Yellow.copy(alpha = 0.3f),
                            disabledContentColor = ChromaPalette.Ink.copy(alpha = 0.5f)
                        )
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                color = ChromaPalette.Ink,
                                strokeWidth = 2.5.dp
                            )
                        } else {
                            Text(
                                text = "Play as Guest",
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Tech Feature Pills
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                FeatureBadge(label = "Authoritative Server")
                Spacer(modifier = Modifier.width(8.dp))
                FeatureBadge(label = "Real-time WSS")
                Spacer(modifier = Modifier.width(8.dp))
                FeatureBadge(label = "$0 Cloudflare DO")
            }
        }
    }
}

@Composable
private fun BrandHeader() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        // 4 color accent bar
        Row(
            modifier = Modifier
                .height(6.dp)
                .width(80.dp)
                .clip(RoundedCornerShape(3.dp))
        ) {
            Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Red))
            Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Yellow))
            Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Green))
            Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Blue))
        }

        Spacer(modifier = Modifier.height(14.dp))

        Text(
            text = "UNO by J",
            style = MaterialTheme.typography.displayLarge,
            fontWeight = FontWeight.Black,
            color = Color.White,
            letterSpacing = (-1).sp
        )

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = "Online Multiplayer Card Game",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = ChromaPalette.Yellow
        )
    }
}

@Composable
private fun FeatureBadge(label: String) {
    Box(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(8.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(
            text = label,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            color = Color.White.copy(alpha = 0.7f)
        )
    }
}
