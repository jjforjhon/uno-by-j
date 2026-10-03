package com.j.uno.ui

import com.j.uno.model.CardColor
import com.j.uno.ui.game.cardColorSymbol
import com.j.uno.ui.game.cardColorToComposeColor
import com.j.uno.ui.theme.ChromaPalette
import org.junit.Assert.assertEquals
import org.junit.Test

class CardComponentTest {

    @Test
    fun testCardColorToComposeColor() {
        assertEquals(ChromaPalette.Red, cardColorToComposeColor(CardColor.R))
        assertEquals(ChromaPalette.Green, cardColorToComposeColor(CardColor.G))
        assertEquals(ChromaPalette.Blue, cardColorToComposeColor(CardColor.B))
        assertEquals(ChromaPalette.Yellow, cardColorToComposeColor(CardColor.Y))
        assertEquals(ChromaPalette.Wild, cardColorToComposeColor(null))
    }

    @Test
    fun testCardColorSymbolsForAccessibility() {
        assertEquals("R", cardColorSymbol(CardColor.R))
        assertEquals("G", cardColorSymbol(CardColor.G))
        assertEquals("B", cardColorSymbol(CardColor.B))
        assertEquals("Y", cardColorSymbol(CardColor.Y))
        assertEquals("W", cardColorSymbol(null))
    }
}
