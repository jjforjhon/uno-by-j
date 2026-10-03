import { describe, expect, it } from "vitest";
import { RoomService, JOIN_LIMIT } from "../../src/room/service";
import { isValidRoomCode } from "../../src/room/codes";
import {
  FakeEventRepo,
  FakeRateLimiter,
  FakeRoomMemberRepo,
  FakeRoomRepo,
  FakeUserRepo,
} from "../helpers";
import type { User } from "../../src/domain/types";

const T0 = 1_700_000_000_000;

function makeUser(id: string, handle: string): User {
  return {
    id,
    handle,
    displayName: handle,
    avatarId: 0,
    isGuest: true,
    state: "ACTIVE",
    createdAt: T0,
    lastSeenAt: T0,
  };
}

function makeService(nowMs: () => number = () => T0) {
  const users = new FakeUserRepo();
  const rooms = new FakeRoomRepo();
  const members = new FakeRoomMemberRepo();
  rooms.members = members; // quickplay seat checks
  const events = new FakeEventRepo();
  const limiter = new FakeRateLimiter();
  const svc = new RoomService({ rooms, members, users, events, limiter, nowMs });
  return { svc, users, rooms, members, events, limiter };
}

async function seedUser(repo: FakeUserRepo, id: string, handle: string): Promise<User> {
  const u = makeUser(id, handle);
  await repo.insert(u);
  return u;
}

describe("room creation", () => {
  it("creates a room with a valid code and the creator as host", async () => {
    const { svc, users } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const view = await svc.create(ada, { isPublic: false, isQuickplay: false });

    expect(isValidRoomCode(view.code)).toBe(true);
    expect(view.members).toHaveLength(1);
    expect(view.members[0]!.userId).toBe("u_1");
    expect(view.members[0]!.isHost).toBe(true);
    expect(view.status).toBe("WAITING");
  });

  it("rejects invalid maxPlayers", async () => {
    const { svc, users } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    await expect(svc.create(ada, { isPublic: false, isQuickplay: false, maxPlayers: 11 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(svc.create(ada, { isPublic: false, isQuickplay: false, maxPlayers: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("enforces the creation rate limit", async () => {
    const { svc, users, limiter } = makeService();
    limiter.allow = false;
    const ada = await seedUser(users, "u_1", "ada");
    await expect(svc.create(ada, { isPublic: false, isQuickplay: false })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});

describe("joining", () => {
  it("adds a member; rejoining is idempotent", async () => {
    const { svc, users } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");
    const room = await svc.create(ada, { isPublic: false, isQuickplay: false });

    const joined = await svc.join(bob, room.code);
    expect(joined.members.map((m) => m.userId)).toEqual(["u_1", "u_2"]);

    const again = await svc.join(bob, room.code);
    expect(again.members).toHaveLength(2); // no duplicate seat
  });

  it("rejects unknown, closed and full rooms with distinct codes", async () => {
    const { svc, users, rooms } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");
    const carol = await seedUser(users, "u_3", "carol");

    await expect(svc.join(ada, "AAAAAA")).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });

    const two = await svc.create(ada, { isPublic: true, isQuickplay: false, maxPlayers: 2 });
    await svc.join(bob, two.code);
    await expect(svc.join(carol, two.code)).rejects.toMatchObject({ code: "ROOM_FULL" });

    await svc.leave(bob, two.code);
    await svc.leave(ada, two.code); // host leaves last -> room closes
    await expect(svc.join(carol, two.code)).rejects.toMatchObject({ code: "ROOM_CLOSED" });

    expect(rooms.rows.get(two.code)?.status).toBe("CLOSED");
  });

  it("enforces the join rate limit (join-code brute force guard)", async () => {
    const { svc, users, limiter } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    limiter.allow = false;
    await expect(svc.join(ada, "AAAAAA")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(limiter.calls.some((c) => c.limit === JOIN_LIMIT)).toBe(true);
  });
});

describe("leaving and host migration", () => {
  it("migrates host to the earliest remaining member when the host leaves", async () => {
    const { svc, users, rooms } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");
    const room = await svc.create(ada, { isPublic: false, isQuickplay: false });
    await svc.join(bob, room.code);

    await svc.leave(ada, room.code);

    const view = await svc.getRoomIfMember(bob, room.code);
    expect(view.hostUserId).toBe("u_2");
    expect(view.members.find((m) => m.userId === "u_2")?.isHost).toBe(true);
    expect(rooms.rows.get(room.code)?.hostUserId).toBe("u_2");
  });

  it("closes the room when the last member leaves; non-host leaves keep host", async () => {
    const { svc, users, rooms, events } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");
    const room = await svc.create(ada, { isPublic: false, isQuickplay: false });
    await svc.join(bob, room.code);

    const nonHost = await svc.leave(bob, room.code);
    expect(nonHost.roomClosed).toBe(false);
    expect(rooms.rows.get(room.code)?.hostUserId).toBe("u_1");

    const last = await svc.leave(ada, room.code);
    expect(last.roomClosed).toBe(true);
    expect(rooms.rows.get(room.code)?.status).toBe("CLOSED");
    expect(events.events.some((e) => e.kind === "ROOM_CLOSED")).toBe(true);
  });

  it("rejects leave for non-members", async () => {
    const { svc, users } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");
    const room = await svc.create(ada, { isPublic: false, isQuickplay: false });
    await expect(svc.leave(bob, room.code)).rejects.toMatchObject({ code: "NOT_MEMBER" });
  });
});

describe("quickplay", () => {
  it("pairs into an existing eligible quickplay room, else creates a ticket", async () => {
    let now = T0;
    const { svc, users } = makeService(() => now);
    const ada = await seedUser(users, "u_1", "ada");
    const bob = await seedUser(users, "u_2", "bob");

    // Ada creates a quickplay ticket.
    const adaRoom = await svc.quickplay(ada);
    expect(adaRoom.isPublic).toBe(true);

    // Too soon: Bob does NOT pair with Ada (fresh ticket window), gets his own room.
    now += 1000;
    const bobRoom = await svc.quickplay(bob);
    expect(bobRoom.code).not.toBe(adaRoom.code);

    // Much later: a third user pairs into the OLDEST eligible ticket (Ada's) — FIFO.
    now += 10_000;
    const carol = await seedUser(users, "u_3", "carol");
    const carolRoom = await svc.quickplay(carol);
    expect(carolRoom.code).toBe(adaRoom.code);
    expect(carolRoom.members.map((m) => m.userId)).toContain("u_3");
  });

  it("enforces the quickplay ticket limit", async () => {
    const { svc, users, limiter } = makeService();
    limiter.allow = false;
    const ada = await seedUser(users, "u_1", "ada");
    await expect(svc.quickplay(ada)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("membership visibility", () => {
  it("getRoomIfMember rejects outsiders; listMyRooms returns active rooms", async () => {
    const { svc, users } = makeService();
    const ada = await seedUser(users, "u_1", "ada");
    const eve = await seedUser(users, "u_9", "eve");
    const room = await svc.create(ada, { isPublic: false, isQuickplay: false });

    await expect(svc.getRoomIfMember(eve, room.code)).rejects.toMatchObject({
      code: "NOT_MEMBER",
    });

    const mine = await svc.listMyRooms(ada);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.code).toBe(room.code);
  });
});
