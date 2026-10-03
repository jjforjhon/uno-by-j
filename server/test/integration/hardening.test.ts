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
    if (typeof msg === "string") {
      this.ws.send(msg);
    } else {
      this.ws.send(JSON.stringify(msg));
    }
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
  vi.useRealTimers();
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

describe("Hardening & Abuse Prevention", () => {
  it("enforces per-socket message rate limit (10 msg/s)", async () => {
    const host = await createGuest("RateHost");
    const code = await createRoom(host);
    const client = await connectWs(code);

    // 1. Send HELLO (message #1)
    client.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
    await client.waitForMessage((m) => m.type === "WELCOME");
    await client.waitForMessage((m) => m.type === "SNAPSHOT");

    // 2. Send 9 PING messages rapidly (messages #2 through #10 within the 1-second window)
    for (let i = 1; i <= 9; i++) {
      client.send({ v: 1, type: "PING", reqId: `ping-${i}`, d: {} });
    }

    // All 9 PINGs receive PONGs
    for (let i = 1; i <= 9; i++) {
      const pong = await client.waitForMessage((m) => m.type === "PONG");
      expect(pong.reqId).toBe(`ping-${i}`);
    }

    // 3. Send message #11 within the same second -> must be rejected with RATE_LIMITED
    client.send({ v: 1, type: "PING", reqId: "ping-11-exceeded", d: {} });
    const err = await client.waitForMessage((m) => m.type === "ERROR");
    expect(err.d.code).toBe("RATE_LIMITED");

    client.ws.close();
    await client.waitForClose();
  });

  it("rejects oversized message frames (> 4096 bytes) with BAD_MESSAGE", async () => {
    const host = await createGuest("SizeHost");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
    await client.waitForMessage((m) => m.type === "WELCOME");
    await client.waitForMessage((m) => m.type === "SNAPSHOT");

    // Send an oversized frame (> 4096 bytes)
    const giantPayload = JSON.stringify({
      v: 1,
      type: "PING",
      reqId: "giant-req",
      d: { filler: "x".repeat(5000) },
    });
    expect(giantPayload.length).toBeGreaterThan(4096);
    client.send(giantPayload);

    const err = await client.waitForMessage((m) => m.type === "ERROR");
    expect(err.d.code).toBe("BAD_MESSAGE");

    client.ws.close();
    await client.waitForClose();
  });

  it("broadcasts PLAYER_DISCONNECTED to remaining members upon abnormal disconnect", async () => {
    const p1 = await createGuest("DiscUser1");
    const p2 = await createGuest("DiscUser2");
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

    // c2 drops abruptly (close with abnormal status or clean close)
    c2.ws.close(1001, "going away");
    await c2.waitForClose();

    // c1 must receive PLAYER_DISCONNECTED event
    const discEv = await c1.waitForMessage(
      (m) => m.type === "EVENT" && m.d.kind === "PLAYER_DISCONNECTED"
    );
    expect(discEv.d.userId).toBe(p2.user.id);

    c1.ws.close();
    await c1.waitForClose();
  });

  it("schedules and executes consecutive turn timeouts without stalling", async () => {
    const p1 = await createGuest("TimeP1");
    const p2 = await createGuest("TimeP2");
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

    // Host starts game
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

    const id = env.ROOM_DO.idFromName(code);
    const stub = env.ROOM_DO.get(id);

    // Timeout 1: Player 1 times out
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31000);
    const alarm1Ran = await runDurableObjectAlarm(stub);
    expect(alarm1Ran).toBe(true);

    // Turn moves to Player 2 (broadcast to both clients)
    const turn2_c2 = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn2_c2.d.playerId).toBe(p2.user.id);
    const turn2_c1 = await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn2_c1.d.playerId).toBe(p2.user.id);

    // Timeout 2: Player 2 also times out
    vi.setSystemTime(Date.now() + 31000);
    const alarm2Ran = await runDurableObjectAlarm(stub);
    expect(alarm2Ran).toBe(true);

    // Turn moves back to Player 1 (broadcast to both clients)
    const turn3_c1 = await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn3_c1.d.playerId).toBe(p1.user.id);
    const turn3_c2 = await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    expect(turn3_c2.d.playerId).toBe(p1.user.id);

    vi.useRealTimers();

    c1.ws.close();
    c2.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose()]);
  });

  it("enforces in-game chat rate limiting (5 messages per 10s)", async () => {
    const host = await createGuest("ChatBurstHost");
    const code = await createRoom(host);
    const client = await connectWs(code);

    client.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
    await client.waitForMessage((m) => m.type === "WELCOME");
    await client.waitForMessage((m) => m.type === "SNAPSHOT");

    // Send 5 chat messages rapidly
    for (let i = 1; i <= 5; i++) {
      client.send({
        v: 1,
        type: "CHAT_SEND",
        reqId: `chat-burst-${i}`,
        d: { text: `Message number ${i}` },
      });
      const ack = await client.waitForMessage((m) => m.type === "ACK" && m.reqId === `chat-burst-${i}`);
      expect(ack.d.ok).toBe(true);
    }

    // 6th message within 10s must be RATE_LIMITED
    client.send({
      v: 1,
      type: "CHAT_SEND",
      reqId: "chat-burst-6",
      d: { text: "Too fast message" },
    });
    const err = await client.waitForMessage((m) => m.type === "ERROR" && m.reqId === "chat-burst-6");
    expect(err.d.code).toBe("RATE_LIMITED");

    client.ws.close();
    await client.waitForClose();
  });
});
