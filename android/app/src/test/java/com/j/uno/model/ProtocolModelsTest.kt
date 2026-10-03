package com.j.uno.model

import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolModelsTest {

    @Test
    fun testClientEnvelopesSerialization() {
        val hello = ClientEnvelope.hello("test-jwt-token")
        val helloJson = UnoJson.encodeToString(ClientEnvelope.serializer(), hello)
        assertTrue(helloJson.contains("\"type\":\"HELLO\""))
        assertTrue(helloJson.contains("\"token\":\"test-jwt-token\""))

        val play = ClientEnvelope.playCard(
            reqId = "req-1",
            actionId = "act-1",
            cardId = "c_r_5_0",
            chosenColor = CardColor.R
        )
        val playJson = UnoJson.encodeToString(ClientEnvelope.serializer(), play)
        assertTrue(playJson.contains("\"actionId\":\"act-1\""))
        assertTrue(playJson.contains("\"cardId\":\"c_r_5_0\""))
        assertTrue(playJson.contains("\"chosenColor\":\"R\""))

        val draw = ClientEnvelope.drawCard("req-2", "act-2")
        val drawJson = UnoJson.encodeToString(ClientEnvelope.serializer(), draw)
        assertTrue(drawJson.contains("\"type\":\"DRAW_CARD\""))
        assertTrue(drawJson.contains("\"actionId\":\"act-2\""))
    }

    @Test
    fun testServerEnvelopeDeserializationWelcome() {
        val json = """
            {
              "v": 1,
              "type": "WELCOME",
              "seq": 1,
              "d": {
                "you": {
                  "userId": "u_user123",
                  "seat": 0
                },
                "roomSeq": 1
              }
            }
        """.trimIndent()

        val env = UnoJson.decodeFromString(ServerEnvelope.serializer(), json)
        assertEquals(1, env.v)
        assertEquals("WELCOME", env.type)
        assertNotNull(env.d)

        val welcome = UnoJson.decodeFromJsonElement(WelcomeData.serializer(), env.d!!)
        assertEquals("u_user123", welcome.you.userId)
        assertEquals(0, welcome.you.seat)
    }

    @Test
    fun testServerEnvelopeDeserializationSnapshot() {
        val json = """
            {
              "v": 1,
              "type": "SNAPSHOT",
              "seq": 2,
              "d": {
                "room": {
                  "code": "X9K2P4",
                  "hostUserId": "u_host1",
                  "isPublic": false,
                  "status": "PLAYING",
                  "maxPlayers": 4,
                  "settings": {
                    "matchMode": false,
                    "stacking": false,
                    "turnTimeoutS": 30
                  },
                  "members": [
                    {
                      "userId": "u_host1",
                      "handle": "host_user",
                      "displayName": "Host Player",
                      "avatarId": 1,
                      "role": "HOST",
                      "isHost": true
                    }
                  ]
                },
                "game": {
                  "gameId": "g_12345",
                  "roomCode": "X9K2P4",
                  "status": "PLAYING",
                  "direction": 1,
                  "currentPlayerId": "u_host1",
                  "currentColor": "R",
                  "topCard": {
                    "id": "c_r_7_0",
                    "color": "R",
                    "kind": "NUMBER",
                    "value": 7
                  },
                  "drawPileCount": 94,
                  "discardPileCount": 1,
                  "turnSeq": 1,
                  "turnDeadlineAt": 1700000000000,
                  "players": [
                    {
                      "userId": "u_host1",
                      "seat": 0,
                      "displayName": "Host Player",
                      "cardCount": 7,
                      "connected": true,
                      "left": false,
                      "hasCalledUno": false,
                      "isCurrent": true
                    }
                  ],
                  "hand": {
                    "cards": [
                      {
                        "id": "c_r_3_0",
                        "color": "R",
                        "kind": "NUMBER",
                        "value": 3
                      }
                    ],
                    "playableIds": ["c_r_3_0"],
                    "canPass": false
                  }
                }
              }
            }
        """.trimIndent()

        val env = UnoJson.decodeFromString(ServerEnvelope.serializer(), json)
        assertEquals("SNAPSHOT", env.type)
        val snapshot = UnoJson.decodeFromJsonElement(SnapshotData.serializer(), env.d!!)
        assertEquals("X9K2P4", snapshot.room.code)
        assertNotNull(snapshot.game)
        assertEquals("g_12345", snapshot.game!!.gameId)
        assertEquals(CardColor.R, snapshot.game!!.currentColor)
        assertEquals(7, snapshot.game!!.topCard.value)
        assertEquals(1, snapshot.game!!.hand.cards.size)
        assertEquals("c_r_3_0", snapshot.game!!.hand.playableIds[0])
    }

    @Test
    fun testServerEnvelopeDeserializationEvents() {
        val gameStartedJson = """
            {
              "kind": "GAME_STARTED",
              "playerCount": 2,
              "firstPlayerId": "u_player1"
            }
        """.trimIndent()

        val event = UnoJson.decodeFromString(GameEvent.serializer(), gameStartedJson)
        assertEquals("GAME_STARTED", event.kind)
        assertEquals(2, event.playerCount)
        assertEquals("u_player1", event.firstPlayerId)

        val turnChangedJson = """
            {
              "kind": "TURN_CHANGED",
              "playerId": "u_player2",
              "deadlineAt": 1700000030000
            }
        """.trimIndent()

        val turnEvent = UnoJson.decodeFromString(GameEvent.serializer(), turnChangedJson)
        assertEquals("TURN_CHANGED", turnEvent.kind)
        assertEquals("u_player2", turnEvent.playerId)
        assertEquals(1700000030000L, turnEvent.deadlineAt)
    }

    @Test
    fun testChatSendEnvelopeSerialization() {
        val chatEnv = ClientEnvelope.chatSend(reqId = "req-chat-1", text = "Good game!")
        val json = UnoJson.encodeToString(ClientEnvelope.serializer(), chatEnv)
        assertTrue(json.contains("\"type\":\"CHAT_SEND\""))
        assertTrue(json.contains("\"reqId\":\"req-chat-1\""))
        assertTrue(json.contains("\"text\":\"Good game!\""))
    }

    @Test
    fun testChatMessageDtoAndModerationModels() {
        val chatDto = ChatMessageDto(
            id = "msg_123",
            roomCode = "ROOM01",
            senderUserId = "u_sender",
            senderDisplayName = "Sender",
            body = "Hello room",
            createdAt = 1700000000000L
        )
        val chatJson = UnoJson.encodeToString(ChatMessageDto.serializer(), chatDto)
        val decodedChat = UnoJson.decodeFromString(ChatMessageDto.serializer(), chatJson)
        assertEquals("msg_123", decodedChat.id)
        assertEquals("Hello room", decodedChat.body)

        val blockReq = BlockRequest(targetUserId = "u_target")
        val blockJson = UnoJson.encodeToString(BlockRequest.serializer(), blockReq)
        val decodedBlock = UnoJson.decodeFromString(BlockRequest.serializer(), blockJson)
        assertEquals("u_target", decodedBlock.targetUserId)

        val blockList = BlockListResponse(blockedUserIds = listOf("u_target1", "u_target2"))
        val blockListJson = UnoJson.encodeToString(BlockListResponse.serializer(), blockList)
        val decodedBlockList = UnoJson.decodeFromString(BlockListResponse.serializer(), blockListJson)
        assertEquals(2, decodedBlockList.blockedUserIds.size)

        val reportReq = ReportRequest(
            targetUserId = "u_target",
            category = "HARASSMENT",
            roomCode = "ROOM01",
            messageId = "msg_123",
            reason = "Offensive chat"
        )
        val reportJson = UnoJson.encodeToString(ReportRequest.serializer(), reportReq)
        val decodedReport = UnoJson.decodeFromString(ReportRequest.serializer(), reportJson)
        assertEquals("HARASSMENT", decodedReport.category)
        assertEquals("msg_123", decodedReport.messageId)

        val reportResp = ReportResponse(ok = true, reportId = "rep_456")
        val reportRespJson = UnoJson.encodeToString(ReportResponse.serializer(), reportResp)
        val decodedResp = UnoJson.decodeFromString(ReportResponse.serializer(), reportRespJson)
        assertTrue(decodedResp.ok)
        assertEquals("rep_456", decodedResp.reportId)
    }

    @Test
    fun testChatMessageEventDeserialization() {
        val chatEventJson = """
            {
              "kind": "CHAT_MESSAGE",
              "id": "msg_999",
              "senderUserId": "u_bob",
              "senderDisplayName": "Bob",
              "body": "Uno!",
              "createdAt": 1700000050000
            }
        """.trimIndent()

        val event = UnoJson.decodeFromString(GameEvent.serializer(), chatEventJson)
        assertEquals("CHAT_MESSAGE", event.kind)
        assertEquals("msg_999", event.id)
        assertEquals("u_bob", event.senderUserId)
        assertEquals("Bob", event.senderDisplayName)
        assertEquals("Uno!", event.body)
        assertEquals(1700000050000L, event.createdAt)
    }
}
