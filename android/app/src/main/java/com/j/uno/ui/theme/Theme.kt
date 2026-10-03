package com.j.uno.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Original visual identity for UNO by J.
 * Deep ink surfaces + saturated card accents; colors are also encoded by symbols in-game
 * (accessibility: never color alone).
 */
object ChromaPalette {
    val Ink = Color(0xFF101528)          // surfaces (dark)
    val InkDeep = Color(0xFF0E1220)      // window background
    val SurfaceLight = Color(0xFFF7F5EE) // surfaces (light)
    val Red = Color(0xFFE5484D)
    val Yellow = Color(0xFFFFD23F)
    val Green = Color(0xFF30A46C)
    val Blue = Color(0xFF0091FF)
    val Wild = Color(0xFF8E4EC6)
}

private val DarkColors = darkColorScheme(
    primary = ChromaPalette.Yellow,
    onPrimary = ChromaPalette.Ink,
    secondary = ChromaPalette.Wild,
    background = ChromaPalette.InkDeep,
    surface = ChromaPalette.Ink,
    surfaceVariant = Color(0xFF1A2138),
    onBackground = Color(0xFFF2EFE6),
    onSurface = Color(0xFFF2EFE6),
    error = ChromaPalette.Red,
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF5B4A00),
    onPrimary = Color(0xFFFFF8E1),
    secondary = ChromaPalette.Wild,
    background = ChromaPalette.SurfaceLight,
    surface = ChromaPalette.SurfaceLight,
    onBackground = Color(0xFF1A1A1A),
    onSurface = Color(0xFF1A1A1A),
    error = Color(0xFFB3261E),
)

@Composable
fun UnoTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = UnoTypography,
        content = content,
    )
}
