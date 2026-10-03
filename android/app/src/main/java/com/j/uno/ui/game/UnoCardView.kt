package com.j.uno.ui.game

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.j.uno.model.CardColor
import com.j.uno.model.CardKind
import com.j.uno.model.UnoCard
import com.j.uno.ui.theme.ChromaPalette

/**
 * Returns the primary display color for a given UNO card color.
 */
fun cardColorToComposeColor(color: CardColor?): Color = when (color) {
    CardColor.R -> ChromaPalette.Red
    CardColor.Y -> ChromaPalette.Yellow
    CardColor.G -> ChromaPalette.Green
    CardColor.B -> ChromaPalette.Blue
    null -> ChromaPalette.Wild
}

/**
 * Returns a short accessibility label for the color (accessible for colorblind players).
 */
fun cardColorSymbol(color: CardColor?): String = when (color) {
    CardColor.R -> "R"
    CardColor.Y -> "Y"
    CardColor.G -> "G"
    CardColor.B -> "B"
    null -> "W"
}

/**
 * Visual representation of an authentic UNO playing card.
 * High-contrast, colorblind-accessible with corner pips, inner oval, and playable glow.
 */
@Composable
fun UnoCardView(
    card: UnoCard,
    modifier: Modifier = Modifier,
    isPlayable: Boolean = false,
    isSelected: Boolean = false,
    cardWidth: Dp = 68.dp,
    cardHeight: Dp = 100.dp,
    onClick: (() -> Unit)? = null
) {
    val baseColor = cardColorToComposeColor(card.color)
    val colorPip = cardColorSymbol(card.color)
    val elevation by animateDpAsState(
        targetValue = if (isPlayable || isSelected) 8.dp else 2.dp,
        animationSpec = tween(durationMillis = 200),
        label = "cardElevation"
    )
    val verticalOffset by animateDpAsState(
        targetValue = if (isSelected || isPlayable) (-6).dp else 0.dp,
        animationSpec = tween(durationMillis = 200),
        label = "cardOffset"
    )

    val cardBorder = when {
        isSelected -> BorderStroke(2.5.dp, Color.White)
        isPlayable -> BorderStroke(2.dp, ChromaPalette.Yellow)
        else -> BorderStroke(1.dp, Color.White.copy(alpha = 0.25f))
    }

    val isWild = (card.kind == CardKind.WILD || card.kind == CardKind.WILD4)

    Card(
        modifier = modifier
            .size(width = cardWidth, height = cardHeight)
            .offset(y = verticalOffset)
            .shadow(elevation, RoundedCornerShape(10.dp))
            .then(
                if (onClick != null) {
                    Modifier.clickable(onClick = onClick)
                } else Modifier
            ),
        shape = RoundedCornerShape(10.dp),
        border = cardBorder,
        colors = CardDefaults.cardColors(
            containerColor = if (isWild) ChromaPalette.Ink else baseColor
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(4.dp)
                .alpha(if (isPlayable || onClick == null) 1f else 0.85f),
            contentAlignment = Alignment.Center
        ) {
            // Inner decorative oval / center badge
            if (isWild) {
                WildCardCenterBadge(kind = card.kind)
            } else {
                StandardCardCenterBadge(card = card, baseColor = baseColor)
            }

            // Top-left corner pip
            Column(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(2.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = cardPipText(card),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White
                )
                Text(
                    text = colorPip,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White.copy(alpha = 0.8f)
                )
            }

            // Bottom-right corner pip
            Column(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(2.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = colorPip,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White.copy(alpha = 0.8f)
                )
                Text(
                    text = cardPipText(card),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White
                )
            }
        }
    }
}

@Composable
private fun StandardCardCenterBadge(card: UnoCard, baseColor: Color) {
    Box(
        modifier = Modifier
            .size(width = 46.dp, height = 70.dp)
            .rotate(-22f)
            .background(Color.White, shape = RoundedCornerShape(50))
            .border(2.dp, baseColor.copy(alpha = 0.4f), RoundedCornerShape(50)),
        contentAlignment = Alignment.Center
    ) {
        val label = when (card.kind) {
            CardKind.NUMBER -> card.value?.toString() ?: ""
            CardKind.SKIP -> "⊘"
            CardKind.REVERSE -> "⇄"
            CardKind.DRAW2 -> "+2"
            CardKind.WILD -> "W"
            CardKind.WILD4 -> "+4"
        }

        Text(
            text = label,
            fontSize = if (card.kind == CardKind.NUMBER) 26.sp else 18.sp,
            fontWeight = FontWeight.Black,
            color = baseColor,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun WildCardCenterBadge(kind: CardKind) {
    Box(
        modifier = Modifier
            .size(width = 48.dp, height = 72.dp)
            .rotate(-20f)
            .background(Color.White, shape = RoundedCornerShape(50)),
        contentAlignment = Alignment.Center
    ) {
        // 4 color quadrant inside the oval
        Column(
            modifier = Modifier.size(34.dp).clip(CircleShape)
        ) {
            Row(modifier = Modifier.weight(1f)) {
                Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Red))
                Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Blue))
            }
            Row(modifier = Modifier.weight(1f)) {
                Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Yellow))
                Box(modifier = Modifier.weight(1f).fillMaxSize().background(ChromaPalette.Green))
            }
        }

        if (kind == CardKind.WILD4) {
            Text(
                text = "+4",
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
                color = Color.White,
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 4.dp, vertical = 1.dp)
            )
        }
    }
}

private fun cardPipText(card: UnoCard): String = when (card.kind) {
    CardKind.NUMBER -> card.value?.toString() ?: ""
    CardKind.SKIP -> "⊘"
    CardKind.REVERSE -> "⇄"
    CardKind.DRAW2 -> "+2"
    CardKind.WILD -> "W"
    CardKind.WILD4 -> "+4"
}

/**
 * Renders the back face of an UNO card (for draw pile, face down cards, opponent hands).
 */
@Composable
fun UnoCardBackView(
    modifier: Modifier = Modifier,
    cardWidth: Dp = 68.dp,
    cardHeight: Dp = 100.dp,
    countBadge: Int? = null,
    isClickable: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    Card(
        modifier = modifier
            .size(width = cardWidth, height = cardHeight)
            .shadow(4.dp, RoundedCornerShape(10.dp))
            .then(
                if (isClickable && onClick != null) Modifier.clickable(onClick = onClick)
                else Modifier
            ),
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.5.dp, Color.White.copy(alpha = 0.4f)),
        colors = CardDefaults.cardColors(containerColor = ChromaPalette.InkDeep)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(4.dp)
                .background(
                    Brush.linearGradient(
                        colors = listOf(ChromaPalette.Ink, Color(0xFF1E2846))
                    ),
                    shape = RoundedCornerShape(8.dp)
                ),
            contentAlignment = Alignment.Center
        ) {
            // Rotated red oval with "UNO"
            Box(
                modifier = Modifier
                    .size(width = 44.dp, height = 68.dp)
                    .rotate(-22f)
                    .background(ChromaPalette.Red, shape = RoundedCornerShape(50))
                    .border(2.dp, ChromaPalette.Yellow, RoundedCornerShape(50)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "UNO",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Black,
                    color = ChromaPalette.Yellow,
                    textAlign = TextAlign.Center
                )
            }

            if (countBadge != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 4.dp)
                        .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = "$countBadge",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }
        }
    }
}
