package com.j.uno.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import com.j.uno.R
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class SoundEffect {
    CARD_PLAY,
    CARD_DRAW,
    YOUR_TURN,
    UNO_CALL,
    VICTORY,
    ROUND_LOST,
    CLICK,
    ERROR
}

@Singleton
class SoundManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val _isSoundEnabled = MutableStateFlow(true)
    val isSoundEnabled: StateFlow<Boolean> = _isSoundEnabled.asStateFlow()

    private val soundPool: SoundPool = SoundPool.Builder()
        .setMaxStreams(6)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        .build()

    private val soundMap = mutableMapOf<SoundEffect, Int>()

    init {
        loadSounds()
    }

    private fun loadSounds() {
        try {
            soundMap[SoundEffect.CARD_PLAY] = soundPool.load(context, R.raw.card_play, 1)
            soundMap[SoundEffect.CARD_DRAW] = soundPool.load(context, R.raw.card_draw, 1)
            soundMap[SoundEffect.YOUR_TURN] = soundPool.load(context, R.raw.your_turn, 1)
            soundMap[SoundEffect.UNO_CALL] = soundPool.load(context, R.raw.uno_call, 1)
            soundMap[SoundEffect.VICTORY] = soundPool.load(context, R.raw.victory, 1)
            soundMap[SoundEffect.ROUND_LOST] = soundPool.load(context, R.raw.round_lost, 1)
            soundMap[SoundEffect.CLICK] = soundPool.load(context, R.raw.click, 1)
            soundMap[SoundEffect.ERROR] = soundPool.load(context, R.raw.error, 1)
        } catch (_: Exception) {
            // Audio loading fallback safe
        }
    }

    fun play(effect: SoundEffect, volume: Float = 1.0f) {
        if (!_isSoundEnabled.value) return
        val soundId = soundMap[effect] ?: return
        if (soundId > 0) {
            try {
                soundPool.play(soundId, volume, volume, 1, 0, 1.0f)
            } catch (_: Exception) {
                // Ignore playback exceptions
            }
        }
    }

    fun toggleSound(): Boolean {
        val next = !_isSoundEnabled.value
        _isSoundEnabled.value = next
        return next
    }

    fun release() {
        try {
            soundPool.release()
        } catch (_: Exception) {}
    }
}
