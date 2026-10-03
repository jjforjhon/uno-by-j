package com.j.uno.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

val UnoJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    encodeDefaults = true
    explicitNulls = false
}

// -------------------------------------------------------------
// Cards & Deck Models
// -------------------------------------------------------------

@Serializable
enum class CardColor {
    @SerialName("R") R,
    @SerialName("G") G,
    @SerialName("B") B,
    @SerialName("Y") Y
}

@Serializable
enum class CardKind {
    @SerialName("NUMBER") NUMBER,
    @SerialName("SKIP") SKIP,
    @SerialName("REVERSE") REVERSE,
    @SerialName("DRAW2") DRAW2,
    @SerialName("WILD") WILD,
    @SerialName("WILD4") WILD4
}

@Serializable
data class UnoCard(
    val id: String,
    val color: CardColor? = null,
    val kind: CardKind,
    val value: Int? = null
)

// -------------------------------------------------------------
// Room Models
// -------------------------------------------------------------

@Serializable
data class RoomSettings(
    val matchMode: Boolean = false,
    val stacking: Boolean = false,
    val turnTimeoutS: Int = 30
)

@Serializable
data class RoomMemberView(
    val userId: String,
    val handle: String,
    val displayName: String,
    val avatarId: Int = 0,
    val role: String,
    val isHost: Boolean
)

@Serializable
data class RoomView(
    val code: String,
    val hostUserId: String,
    val isPublic: Boolean,
    val status: String,
    val maxPlayers: Int,
    val settings: RoomSettings = RoomSettings(),
    val members: List<RoomMemberView> = emptyList()
)

// -------------------------------------------------------------
// Authoritative Game View & Projection
// -------------------------------------------------------------

@Serializable
data class PublicPlayerView(
    val userId: String,
    val seat: Int,
    val displayName: String,
    val cardCount: Int,
    val connected: Boolean = true,
    val left: Boolean = false,
    val hasCalledUno: Boolean = false,
    val isCurrent: Boolean = false
)

@Serializable
data class SelfHandView(
    val cards: List<UnoCard> = emptyList(),
    val playableIds: List<String> = emptyList(),
    val canPass: Boolean = false
)

@Serializable
data class RoundScore(
    val userId: String,
    val handPoints: Int
)

@Serializable
data class GameSnapshotView(
    val gameId: String,
    val roomCode: String,
    val status: String,
    val direction: Int,
    val currentPlayerId: String? = null,
    val currentColor: CardColor,
    val topCard: UnoCard,
    val drawPileCount: Int,
    val discardPileCount: Int,
    val turnSeq: Int,
    val turnDeadlineAt: Long,
    val pendingUnoOffenderId: String? = null,
    val players: List<PublicPlayerView> = emptyList(),
    val hand: SelfHandView = SelfHandView(),
    val winnerUserId: String? = null,
    val lastScores: List<RoundScore>? = null
)

// -------------------------------------------------------------
// REST API DTOs
// -------------------------------------------------------------

@Serializable
data class UserDto(
    val id: String,
    val handle: String,
    val displayName: String,
    val avatarId: Int = 0
)

@Serializable
data class GuestRequest(
    val displayName: String
)

@Serializable
data class RefreshRequest(
    val refreshToken: String
)

@Serializable
data class AuthResponse(
    val user: UserDto,
    val accessToken: String,
    val refreshToken: String
)

@Serializable
data class CreateRoomRequest(
    val isPublic: Boolean = false,
    val maxPlayers: Int = 4,
    val settings: RoomSettings? = null
)

@Serializable
data class RoomResponse(
    val room: RoomView
)

@Serializable
data class MyRoomsResponse(
    val rooms: List<RoomView>
)

@Serializable
data class ErrorBody(
    val code: String
)

@Serializable
data class ErrorResponse(
    val error: ErrorBody
)

@Serializable
data class BlockRequest(
    val targetUserId: String
)

@Serializable
data class BlockListResponse(
    val blockedUserIds: List<String> = emptyList()
)

@Serializable
data class ReportRequest(
    val targetUserId: String,
    val category: String,
    val roomCode: String? = null,
    val messageId: String? = null,
    val reason: String? = null
)

@Serializable
data class ReportResponse(
    val ok: Boolean,
    val reportId: String
)

@Serializable
data class OkResponse(
    val ok: Boolean
)

// -------------------------------------------------------------
// WebSocket Envelopes & Payloads
// -------------------------------------------------------------

@Serializable
data class ClientEnvelope(
    val v: Int = 1,
    val type: String,
    val reqId: String? = null,
    val d: JsonObject? = null
) {
    companion object {
        fun hello(token: String): ClientEnvelope = ClientEnvelope(
            type = "HELLO",
            d = buildJsonObject { put("token", token) }
        )

        fun playCard(reqId: String, actionId: String, cardId: String, chosenColor: CardColor? = null): ClientEnvelope = ClientEnvelope(
            type = "PLAY_CARD",
            reqId = reqId,
            d = buildJsonObject {
                put("actionId", actionId)
                put("cardId", cardId)
                if (chosenColor != null) {
                    put("chosenColor", chosenColor.name)
                }
            }
        )

        fun drawCard(reqId: String, actionId: String): ClientEnvelope = ClientEnvelope(
            type = "DRAW_CARD",
            reqId = reqId,
            d = buildJsonObject { put("actionId", actionId) }
        )

        fun pass(reqId: String, actionId: String): ClientEnvelope = ClientEnvelope(
            type = "PASS",
            reqId = reqId,
            d = buildJsonObject { put("actionId", actionId) }
        )

        fun callUno(reqId: String, actionId: String): ClientEnvelope = ClientEnvelope(
            type = "CALL_UNO",
            reqId = reqId,
            d = buildJsonObject { put("actionId", actionId) }
        )

        fun catchUno(reqId: String, actionId: String, targetPlayerId: String): ClientEnvelope = ClientEnvelope(
            type = "CATCH_UNO",
            reqId = reqId,
            d = buildJsonObject {
                put("actionId", actionId)
                put("targetPlayerId", targetPlayerId)
            }
        )

        fun syncReq(reqId: String, sinceSeq: Int): ClientEnvelope = ClientEnvelope(
            type = "SYNC_REQ",
            reqId = reqId,
            d = buildJsonObject { put("sinceSeq", sinceSeq) }
        )

        fun ping(reqId: String): ClientEnvelope = ClientEnvelope(
            type = "PING",
            reqId = reqId
        )

        fun leave(reqId: String): ClientEnvelope = ClientEnvelope(
            type = "LEAVE",
            reqId = reqId
        )

        fun chatSend(reqId: String, text: String): ClientEnvelope = ClientEnvelope(
            type = "CHAT_SEND",
            reqId = reqId,
            d = buildJsonObject { put("text", text) }
        )
    }
}

@Serializable
data class ServerEnvelope(
    val v: Int = 1,
    val type: String,
    val seq: Int? = null,
    val reqId: String? = null,
    val d: JsonElement? = null
)

@Serializable
data class WelcomeYou(
    val userId: String,
    val seat: Int
)

@Serializable
data class WelcomeData(
    val you: WelcomeYou,
    val roomSeq: Int? = null
)

@Serializable
data class ChatMessageDto(
    val id: String,
    val roomCode: String,
    val senderUserId: String,
    val senderDisplayName: String,
    val body: String,
    val createdAt: Long
)

@Serializable
data class SnapshotData(
    val room: RoomView,
    val game: GameSnapshotView? = null,
    val chat: List<ChatMessageDto> = emptyList()
)

@Serializable
data class AckData(
    val ok: Boolean,
    val seq: Int? = null,
    val duplicate: Boolean? = null,
    val messageId: String? = null
)

@Serializable
data class ServerErrorData(
    val code: String
)

@Serializable
data class GameEvent(
    val kind: String,
    val playerCount: Int? = null,
    val firstPlayerId: String? = null,
    val playerId: String? = null,
    val deadlineAt: Long? = null,
    val card: UnoCard? = null,
    val newColor: CardColor? = null,
    val playerCardCount: Int? = null,
    val drawPileCount: Int? = null,
    val count: Int? = null,
    val reason: String? = null,
    val cards: List<UnoCard>? = null,
    val newCount: Int? = null,
    val direction: Int? = null,
    val offenderId: String? = null,
    val catcherId: String? = null,
    val userId: String? = null,
    val displayName: String? = null,
    val winnerUserId: String? = null,
    val scores: List<RoundScore>? = null,
    val room: RoomView? = null,
    val id: String? = null,
    val senderUserId: String? = null,
    val senderDisplayName: String? = null,
    val body: String? = null,
    val createdAt: Long? = null
)
