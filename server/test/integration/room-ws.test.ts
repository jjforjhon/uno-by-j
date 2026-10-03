import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyD1Migrations, env, SELF, listDurableObjectIds, runDurableObjectAlarm } from "cloudflare:test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

interface TokenPair {
  user: { id: string; handle: string; displayName: string };
  accessToken: string;
  refreshToken: string;
}

interface ServerMsg {
  v: number;
  type: string;
  seq?: number;
  reqId?: string;
  d: any;
}

async function createGuest(name: string): Promise<TokenPair> {
  const res = await SELF.fetch("https://example.com/auth/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as TokenPair;
}

async function createRoom(t: TokenPair): Promise<string> {
  const res = await SELF.fetch("https://example.com/room", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ isPublic: false, maxPlayers: 4 }),
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { room: { code: string } };
  return data.room.code;
}

async function joinRoom(t: TokenPair, code: string): Promise<void> {
  const res = await SELF.fetch(`https://example.com/room/${code}/join`, {
    method: "POST",
    headers: { authorization: `Bearer ${t.accessToken}` },
  });
  expect(res.status).toBe(200);
  await res.text();
}

class TestWsClient {
  readonly ws: WebSocket;
  readonly messages: ServerMsg[] = [];
  private listeners: ((msg: ServerMsg) => void)[] = [];
  closeEvent: { code: number; reason: string } | null = null;
  private closeListeners: ((ev: { code: number; reason: string }) => void)[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.accept();
    this.ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as ServerMsg;
      if (this.listeners.length > 0) {
        const fn = this.listeners.shift()!;
        fn(data);
      } else {
        this.messages.push(data);
      }
    });
    this.ws.addEventListener("close", (event) => {
      this.closeEvent = { code: event.code, reason: event.reason };
      for (const fn of this.closeListeners) {
        fn(this.closeEvent);
      }
      this.closeListeners = [];
    });
  }

  send(msg: any) {
    this.ws.send(JSON.stringify(msg));
  }

  async waitForMessage(predicate?: (msg: ServerMsg) => boolean, timeoutMs = 3000): Promise<ServerMsg> {
    for (let i = 0; i < this.messages.length; i++) {
      if (!predicate || predicate(this.messages[i]!)) {
        return this.messages.splice(i, 1)[0]!;
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitForMessage timed out")), timeoutMs);
      const listener = (msg: ServerMsg) => {
        if (!predicate || predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        } else {
          this.listeners.push(listener);
        }
      };
      this.listeners.push(listener);
    });
  }

  async waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    if (this.closeEvent) return this.closeEvent;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitForClose timed out")), timeoutMs);
      this.closeListeners.push((ev) => {
        clearTimeout(timer);
        resolve(ev);
      });
    });
  }
}

const openClients: TestWsClient[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    const c = openClients.pop();
    try {
      c?.ws.close(1000, "test end");
    } catch {}
  }
  const ids = await listDurableObjectIds(env.ROOM_DO);
  for (const id of ids) {
    const stub = env.ROOM_DO.get(id);
    const r = await stub.fetch("https://room.internal/test/reset", { method: "POST" }).catch(() => null);
    await r?.text().catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 20));
});

async function connectWs(code: string): Promise<TestWsClient> {
  const res = await SELF.fetch(`https://example.com/room/${code}/ws`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  expect(res.webSocket).toBeDefined();
  const client = new TestWsClient(res.webSocket!);
  openClients.push(client);
  return client;
}

describe("WebSocket synchronization & RoomDO lifecycle", () => {
  it("rejects non-HELLO as first message with 4001", async () => {
    const host = await createGuest("HostA");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "PING", reqId: "req-1" });
    const close = await client.waitForClose();
    expect(close.code).toBe(4001);
  });

  it("rejects invalid/expired auth tokens", async () => {
    const host = await createGuest("HostB");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "HELLO", d: { token: "bad.jwt.token" } });
    const err = await client.waitForMessage((m) => m.type === "ERROR");
    expect(err.d.code).toBe("AUTH_REQUIRED");
    const close = await client.waitForClose();
    expect(close.code).toBe(3000);
  });

  it("rejects non-members with NOT_MEMBER", async () => {
    const host = await createGuest("HostC");
    const outsider = await createGuest("Outsider");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "HELLO", d: { token: outsider.accessToken } });
    const err = await client.waitForMessage((m) => m.type === "ERROR");
    expect(err.d.code).toBe("NOT_MEMBER");
    const close = await client.waitForClose();
    expect(close.code).toBe(3000);
  });

  it("completes HELLO -> WELCOME -> SNAPSHOT handshake for room members", async () => {
    const host = await createGuest("HostD");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
    const welcome = await client.waitForMessage((m) => m.type === "WELCOME");
    expect(welcome.d.you.userId).toBe(host.user.id);

    const snapshot = await client.waitForMessage((m) => m.type === "SNAPSHOT");
    expect(snapshot.d.room.code).toBe(code);
    expect(snapshot.d.game).toBeNull();

    client.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("starts game, broadcasts GAME_STARTED, assigns turns, and respects sanitization", async () => {
    const p1 = await createGuest("Player1");
    const p2 = await createGuest("Player2");
    const code = await createRoom(p1);
    await joinRoom(p2, code);

    const c1 = await connectWs(code);
    c1.send({ v: 1, type: "HELLO", d: { token: p1.accessToken } });
    await c1.waitForMessage((m) => m.type === "WELCOME");
    await c1.waitForMessage((m) => m.type === "SNAPSHOT");

    const c2 = await connectWs(code);
    c2.send({ v: 1, type: "HELLO", d: { token: p2.accessToken } });
    await c2.waitForMessage((m) => m.type === "WELCOME");
    await c2.waitForMessage((m) => m.type === "SNAPSHOT");

    // Non-host cannot start game
    const badStart = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${p2.accessToken}` },
    });
    expect(badStart.status).toBe(403);
    await badStart.text();

    // Host starts game
    const startRes = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${p1.accessToken}` },
    });
    expect(startRes.status).toBe(200);
    await startRes.text();

    // Both players receive GAME_STARTED and TURN_CHANGED events
    const start1 = await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    expect(start1.d.playerCount).toBe(2);
    const turn1 = await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn1.d.playerId).toBe(p1.user.id);

    const start2 = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    expect(start2.d.playerCount).toBe(2);
    const turn2 = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn2.d.playerId).toBe(p1.user.id);

    // Reconnection / SYNC_REQ test:
    // When Player 1 sends SYNC_REQ, they receive their sanitized snapshot
    c1.send({ v: 1, type: "SYNC_REQ", reqId: "sync-1", d: { sinceSeq: 0 } });
    const snap1 = await c1.waitForMessage((m) => m.type === "SNAPSHOT");
    expect(snap1.d.game).not.toBeNull();
    // Sanitization: Player 1 sees their own hand (7 cards)
    expect(snap1.d.game.hand.cards).toHaveLength(7);
    // Opponent's hand is NOT exposed, only card count
    const opp = snap1.d.game.players.find((p: any) => p.userId === p2.user.id);
    expect(opp.cardCount).toBe(7);
    expect(opp.hand).toBeUndefined();

    c1.ws.close();
    c2.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose()]);
    const id = env.ROOM_DO.idFromName(code);
    const stub = env.ROOM_DO.get(id);
    const resetRes = await stub.fetch("https://room.internal/test/reset", { method: "POST" });
    await resetRes.text();
  });

  it("enforces action idempotency on retried actionId", async () => {
    const p1 = await createGuest("Idem1");
    const p2 = await createGuest("Idem2");
    const code = await createRoom(p1);
    await joinRoom(p2, code);

    const c1 = await connectWs(code);
    c1.send({ v: 1, type: "HELLO", d: { token: p1.accessToken } });
    await c1.waitForMessage((m) => m.type === "WELCOME");
    await c1.waitForMessage((m) => m.type === "SNAPSHOT");

    const startRes = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${p1.accessToken}` },
    });
    expect(startRes.status).toBe(200);
    await startRes.text();

    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");

    // Player 1 draws a card
    const actionId = "draw-action-123";
    c1.send({
      v: 1,
      type: "DRAW_CARD",
      reqId: "req-draw-1",
      d: { actionId },
    });

    const ack1 = await c1.waitForMessage((m) => m.type === "ACK");
    expect(ack1.d.ok).toBe(true);

    // Retrying the same actionId returns duplicate ACK without executing twice
    c1.send({
      v: 1,
      type: "DRAW_CARD",
      reqId: "req-draw-2",
      d: { actionId },
    });

    const ack2 = await c1.waitForMessage((m) => m.type === "ACK");
    expect(ack2.d.ok).toBe(true);
    expect(ack2.d.duplicate).toBe(true);

    c1.ws.close();
    await c1.waitForClose();
    const id2 = env.ROOM_DO.idFromName(code);
    const stub2 = env.ROOM_DO.get(id2);
    const resetRes2 = await stub2.fetch("https://room.internal/test/reset", { method: "POST" });
    await resetRes2.text();
  });

  it("triggers TIMEOUT_TURN via Durable Object alarm on turn expiration", async () => {
    const p1 = await createGuest("Timeout1");
    const p2 = await createGuest("Timeout2");
    const code = await createRoom(p1);
    await joinRoom(p2, code);

    const c1 = await connectWs(code);
    c1.send({ v: 1, type: "HELLO", d: { token: p1.accessToken } });
    await c1.waitForMessage((m) => m.type === "WELCOME");
    await c1.waitForMessage((m) => m.type === "SNAPSHOT");

    const c2 = await connectWs(code);
    c2.send({ v: 1, type: "HELLO", d: { token: p2.accessToken } });
    await c2.waitForMessage((m) => m.type === "WELCOME");
    await c2.waitForMessage((m) => m.type === "SNAPSHOT");

    const startRes = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${p1.accessToken}` },
    });
    expect(startRes.status).toBe(200);
    await startRes.text();

    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    const turn1 = await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn1.d.playerId).toBe(p1.user.id);

    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");

    // Advance time past the 30-second turn timeout
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31000);

    const id = env.ROOM_DO.idFromName(code);
    const stub = env.ROOM_DO.get(id);

    // Run the DO alarm
    const alarmRan = await runDurableObjectAlarm(stub);
    expect(alarmRan).toBe(true);

    // Player 1 timed out -> server drew a card for them and passed -> turn passed to Player 2
    const passTurn = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(passTurn.d.playerId).toBe(p2.user.id);

    vi.useRealTimers();

    c1.ws.close();
    c2.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose()]);
    const resetRes = await stub.fetch("https://room.internal/test/reset", { method: "POST" });
    await resetRes.text();
  });

  it("dispatches real-time in-game chat and replays recent chat in SNAPSHOT", async () => {
    const p1 = await createGuest("Chatter1");
    const p2 = await createGuest("Chatter2");
    const code = await createRoom(p1);
    await joinRoom(p2, code);

    const c1 = await connectWs(code);
    c1.send({ v: 1, type: "HELLO", d: { token: p1.accessToken } });
    await c1.waitForMessage((m) => m.type === "SNAPSHOT");

    const c2 = await connectWs(code);
    c2.send({ v: 1, type: "HELLO", d: { token: p2.accessToken } });
    await c2.waitForMessage((m) => m.type === "SNAPSHOT");

    // Player 1 sends a chat message
    c1.send({ v: 1, type: "CHAT_SEND", reqId: "chat_req_1", d: { text: "Hello everyone!" } });

    // Player 1 gets an ACK with sequence number and messageId
    const ack = await c1.waitForMessage((m) => m.type === "ACK" && m.reqId === "chat_req_1");
    expect(ack.d.ok).toBe(true);
    expect(ack.d.messageId).toBeDefined();

    // Player 2 receives the EVENT broadcast
    const chatEv = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "CHAT_MESSAGE");
    expect(chatEv.d.body).toBe("Hello everyone!");
    expect(chatEv.d.senderUserId).toBe(p1.user.id);
    expect(chatEv.d.senderDisplayName).toBe("Chatter1");

    // A third connection or reconnecting client receives the message in SNAPSHOT
    const c3 = await connectWs(code);
    c3.send({ v: 1, type: "HELLO", d: { token: p2.accessToken } });
    const snap = await c3.waitForMessage((m) => m.type === "SNAPSHOT");
    expect(snap.d.chat).toBeDefined();
    expect(snap.d.chat.length).toBeGreaterThanOrEqual(1);
    expect(snap.d.chat[0].body).toBe("Hello everyone!");

    c1.ws.close();
    c2.ws.close();
    c3.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose(), c3.waitForClose()]);

    const id = env.ROOM_DO.idFromName(code);
    const stub = env.ROOM_DO.get(id);
    const resetRes = await stub.fetch("https://room.internal/test/reset", { method: "POST" });
    await resetRes.text();
  });
});

