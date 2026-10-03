import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF } from "cloudflare:test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

interface TokenPair {
  user: { id: string; handle: string };
  accessToken: string;
  refreshToken: string;
}

interface RoomView {
  code: string;
  hostUserId: string;
  status: string;
  maxPlayers: number;
  members: Array<{ userId: string; isHost: boolean }>;
}

async function guest(name: string): Promise<TokenPair> {
  const res = await SELF.fetch("https://example.com/auth/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as TokenPair;
}

async function createRoom(
  t: TokenPair,
  opts: { maxPlayers?: number; isQuickplay?: boolean } = {}
): Promise<{ status: number; room: RoomView }> {
  const res = await SELF.fetch("https://example.com/room", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({
      isPublic: false,
      isQuickplay: opts.isQuickplay ?? false,
      ...(opts.maxPlayers ? { maxPlayers: opts.maxPlayers } : {}),
    }),
  });
  const body = (await res.json()) as { room?: RoomView };
  return { status: res.status, room: body.room! };
}

async function joinRoom(
  t: TokenPair,
  code: string
): Promise<{ status: number; body: { room?: RoomView; error?: { code: string } } }> {
  const res = await SELF.fetch(`https://example.com/room/${code}/join`, {
    method: "POST",
    headers: { authorization: `Bearer ${t.accessToken}` },
  });
  return { status: res.status, body: (await res.json()) };
}

describe("room lifecycle over HTTP", () => {
  it("create -> join -> host migration -> close", async () => {
    const ada = await guest("Ada");
    const bob = await guest("Bob");

    const created = await createRoom(ada, { maxPlayers: 4 });
    expect(created.status).toBe(201);
    expect(created.room.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(created.room.members).toHaveLength(1);
    expect(created.room.members[0]!.userId).toBe(ada.user.id);

    const code = created.room.code;

    const joined = await joinRoom(bob, code);
    expect(joined.status).toBe(200);
    expect(joined.body.room!.members).toHaveLength(2);

    // Rejoin is idempotent.
    const rejoin = await joinRoom(bob, code);
    expect(rejoin.status).toBe(200);
    expect(rejoin.body.room!.members).toHaveLength(2);

    // Host leaves -> bob becomes host.
    const leaveRes = await SELF.fetch(`https://example.com/room/${code}/leave`, {
      method: "POST",
      headers: { authorization: `Bearer ${ada.accessToken}` },
    });
    expect(leaveRes.status).toBe(200);
    expect((await leaveRes.json()) as { roomClosed: boolean }).toEqual({ roomClosed: false });

    const bobView = await SELF.fetch(`https://example.com/room/${code}`, {
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    const bobData = (await bobView.json()) as { room: RoomView };
    expect(bobData.room.hostUserId).toBe(bob.user.id);
    expect(bobData.room.members.find((m) => m.userId === bob.user.id)?.isHost).toBe(true);

    // Last member leaves -> room closes.
    const bobLeave = await SELF.fetch(`https://example.com/room/${code}/leave`, {
      method: "POST",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(((await bobLeave.json()) as { roomClosed: boolean }).roomClosed).toBe(true);

    // Joining a closed room fails distinctly.
    const carol = await guest("Carol");
    const closedJoin = await joinRoom(carol, code);
    expect(closedJoin.status).toBe(409);
    expect(closedJoin.body.error?.code).toBe("ROOM_CLOSED");
  });

  it("enforces capacity atomically at the API layer", async () => {
    const ada = await guest("Ada");
    const bob = await guest("Bob");
    const carol = await guest("Carol");
    const { room } = await createRoom(ada, { maxPlayers: 2 });

    expect((await joinRoom(bob, room.code)).status).toBe(200);
    const third = await joinRoom(carol, room.code);
    expect(third.status).toBe(409);
    expect(third.body.error?.code).toBe("ROOM_FULL");
  });

  it("keeps private rooms invisible to non-members but visible to members", async () => {
    const ada = await guest("Ada");
    const eve = await guest("Eve");
    const { room } = await createRoom(ada);

    const outsider = await SELF.fetch(`https://example.com/room/${room.code}`, {
      headers: { authorization: `Bearer ${eve.accessToken}` },
    });
    expect(outsider.status).toBe(403);
    expect(((await outsider.json()) as { error: { code: string } }).error.code).toBe("NOT_MEMBER");

    const insider = await SELF.fetch(`https://example.com/room/${room.code}`, {
      headers: { authorization: `Bearer ${ada.accessToken}` },
    });
    expect(insider.status).toBe(200);
  });

  it("lists my active rooms", async () => {
    const ada = await guest("Ada");
    const { room } = await createRoom(ada);
    const res = await SELF.fetch("https://example.com/my/rooms", {
      headers: { authorization: `Bearer ${ada.accessToken}` },
    });
    const data = (await res.json()) as { rooms: RoomView[] };
    expect(data.rooms.some((r) => r.code === room.code)).toBe(true);
  });

  it("rejects unauthenticated room access", async () => {
    const noAuth = await SELF.fetch("https://example.com/room", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: false, isQuickplay: false }),
    });
    expect(noAuth.status).toBe(401);

    const noAuthJoin = await SELF.fetch("https://example.com/room/AAAAAA/join", {
      method: "POST",
    });
    expect(noAuthJoin.status).toBe(401);
  });

  it("quickplay returns a valid ticket", async () => {
    const ada = await guest("Ada");
    const res = await SELF.fetch("https://example.com/room/quickplay", {
      method: "POST",
      headers: { authorization: `Bearer ${ada.accessToken}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { room: RoomView };
    expect(data.room.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(data.room.members.some((m) => m.userId === ada.user.id)).toBe(true);
  });

  it("rejects unknown room codes distinctly", async () => {
    const ada = await guest("Ada");
    const res = await joinRoom(ada, "ZZZZZZ");
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("ROOM_NOT_FOUND");
  });
});
