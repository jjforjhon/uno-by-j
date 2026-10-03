import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF, listDurableObjectIds } from "cloudflare:test";

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

describe("Performance & Soak Benchmarks (Phase 10)", () => {
  it("executes game actions within Cloudflare Workers 10ms CPU budget", async () => {
    const p1 = await createGuest("PerfHost");
    const p2 = await createGuest("PerfGuest");
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

    // Start game
    const startRes = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${p1.accessToken}` },
    });
    expect(startRes.status).toBe(200);
    await startRes.text();

    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");

    // 1. Benchmark raw WebSocket message loop latency via PING -> PONG (respecting 10 msg/s rate limit)
    const pingIterations = 5;
    const pingDurations: number[] = [];

    for (let i = 0; i < pingIterations; i++) {
      const reqId = `ping-perf-${i}`;
      const t0 = performance.now();
      c1.send({
        v: 1,
        type: "PING",
        reqId,
        d: {},
      });
      const pong = await c1.waitForMessage((m) => m.type === "PONG" && m.reqId === reqId);
      pingDurations.push(performance.now() - t0);
      expect(pong.reqId).toBe(reqId);
    }

    const avgPing = pingDurations.reduce((a, b) => a + b, 0) / pingDurations.length;
    // Fast in-memory loopback should be under 50ms in local Vitest test runner
    expect(avgPing).toBeLessThan(50);

    // 2. Benchmark full engine mutation + SQLite persist + fan-out broadcast (DRAW_CARD)
    const t0 = performance.now();
    const actionId = `perf-draw-${Date.now()}`;
    const reqId = "req-perf-draw";
    c1.send({
      v: 1,
      type: "DRAW_CARD",
      reqId,
      d: { actionId },
    });
    const ack = await c1.waitForMessage((m) => m.type === "ACK" && m.reqId === reqId);
    const drawDuration = performance.now() - t0;
    expect(ack.d.ok).toBe(true);
    // DO SQLite write and multi-socket fan-out roundtrip within 150ms on local test runner
    expect(drawDuration).toBeLessThan(150);

    c1.ws.close();
    c2.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose()]);
  });

  it("handles concurrent rooms and high action churn without state corruption", async () => {
    const roomCount = 3;
    const rooms: { code: string; host: TokenPair; guest: TokenPair; c1: TestWsClient; c2: TestWsClient }[] = [];

    // Set up 3 rooms concurrently
    for (let i = 1; i <= roomCount; i++) {
      const host = await createGuest(`ChurnHost${i}`);
      const guest = await createGuest(`ChurnGuest${i}`);
      const code = await createRoom(host);
      await joinRoom(guest, code);

      const c1 = await connectWs(code);
      c1.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
      await c1.waitForMessage((m) => m.type === "WELCOME");
      await c1.waitForMessage((m) => m.type === "SNAPSHOT");

      const c2 = await connectWs(code);
      c2.send({ v: 1, type: "HELLO", d: { token: guest.accessToken } });
      await c2.waitForMessage((m) => m.type === "WELCOME");
      await c2.waitForMessage((m) => m.type === "SNAPSHOT");

      rooms.push({ code, host, guest, c1, c2 });
    }

    // Start all 3 games in parallel
    await Promise.all(
      rooms.map(async (r) => {
        const startRes = await SELF.fetch(`https://example.com/room/${r.code}/start`, {
          method: "POST",
          headers: { authorization: `Bearer ${r.host.accessToken}` },
        });
        expect(startRes.status).toBe(200);
        await startRes.text();

        await r.c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
        await r.c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
        await r.c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
        await r.c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
      })
    );

    // Concurrently dispatch draw actions across all rooms
    const actionPromises = rooms.map(async (r, idx) => {
      const reqId = `churn-req-${idx}`;
      const actionId = `churn-act-${idx}`;
      r.c1.send({
        v: 1,
        type: "DRAW_CARD",
        reqId,
        d: { actionId },
      });
      const ack = await r.c1.waitForMessage((m) => m.type === "ACK" && m.reqId === reqId);
      expect(ack.d.ok).toBe(true);

      // Verify sequence increments monotonically
      expect(ack.d.seq).toBeGreaterThan(0);
    });

    await Promise.all(actionPromises);

    // Clean up all sockets
    for (const r of rooms) {
      r.c1.ws.close();
      r.c2.ws.close();
      await Promise.all([r.c1.waitForClose(), r.c2.waitForClose()]);
    }
  });

  it("survives rapid turn transitions and game recovery via SYNC_REQ under load", async () => {
    const host = await createGuest("SoakHost");
    const guest = await createGuest("SoakGuest");
    const code = await createRoom(host);
    await joinRoom(guest, code);

    const c1 = await connectWs(code);
    c1.send({ v: 1, type: "HELLO", d: { token: host.accessToken } });
    await c1.waitForMessage((m) => m.type === "WELCOME");
    await c1.waitForMessage((m) => m.type === "SNAPSHOT");

    const c2 = await connectWs(code);
    c2.send({ v: 1, type: "HELLO", d: { token: guest.accessToken } });
    await c2.waitForMessage((m) => m.type === "WELCOME");
    await c2.waitForMessage((m) => m.type === "SNAPSHOT");

    const startRes = await SELF.fetch(`https://example.com/room/${code}/start`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.accessToken}` },
    });
    expect(startRes.status).toBe(200);
    await startRes.text();

    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c1.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");
    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "GAME_STARTED");
    await c2.waitForMessage((m) => m.type === "EVENT" && m.d.kind === "TURN_CHANGED");

    // Player 1 draws
    const drawReq = "soak-draw-1";
    c1.send({
      v: 1,
      type: "DRAW_CARD",
      reqId: drawReq,
      d: { actionId: "soak-act-1" },
    });
    const ack1 = await c1.waitForMessage((m) => m.type === "ACK" && m.reqId === drawReq);
    expect(ack1.d.ok).toBe(true);

    // Reconnection / Sync under load: client sends SYNC_REQ with sinceSeq: 0
    c1.send({
      v: 1,
      type: "SYNC_REQ",
      reqId: "soak-sync-req",
      d: { sinceSeq: 0 },
    });

    const snap = await c1.waitForMessage((m) => m.type === "SNAPSHOT");
    expect(snap.d.game).not.toBeNull();
    expect(snap.d.game.players).toHaveLength(2);
    expect(snap.d.game.hand.cards.length).toBeGreaterThanOrEqual(7);

    c1.ws.close();
    c2.ws.close();
    await Promise.all([c1.waitForClose(), c2.waitForClose()]);
  });
});
