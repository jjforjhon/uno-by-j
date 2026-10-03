import type {
  RateLimiter,
  RoomMemberRepo,
  RoomRepo,
  SecurityEventRepo,
  UserRepo,
} from "../domain/repos";
import type { MemberRole, Room, RoomMember, RoomView, StartRoomOptions } from "../domain/rooms";
import { DEFAULT_ROOM_SETTINGS, MAX_PLAYERS, MIN_PLAYERS } from "../domain/rooms";
import { badRequest, forbidden, notMember, roomClosed, roomFull } from "../domain/errors";
import { AppError, ErrorCode } from "../domain/errors";
import type { User } from "../domain/types";
import { generateRoomCode } from "./codes";
import { randomId } from "../util/crypto";

export const ROOM_CREATE_LIMIT = 3;      // per user per hour
export const QUICKPLAY_TICKET_LIMIT = 1; // active tickets per user per hour
export const JOIN_LIMIT = 30;            // joins per user per hour (brute-force join guard)

export interface RoomServiceDeps {
  rooms: RoomRepo;
  members: RoomMemberRepo;
  users: UserRepo;
  events: SecurityEventRepo;
  limiter: RateLimiter;
  /** Maps a room code to its DO stub; optional so unit tests can omit it. */
  roomStub?: (code: string) => { fetch: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown> };
  nowMs?: () => number;
}

export interface CreateRoomInput {
  isPublic: boolean;
  isQuickplay: boolean;
  maxPlayers?: number;
  settings?: Partial<typeof DEFAULT_ROOM_SETTINGS>;
}

export class RoomService {
  private readonly now: () => number;

  constructor(private readonly d: RoomServiceDeps) {
    this.now = d.nowMs ?? (() => Date.now());
  }

  async create(user: User, input: CreateRoomInput): Promise<RoomView> {
    const allowed = await this.d.limiter.check(`room-create:${user.id}`, ROOM_CREATE_LIMIT, 60 * 60 * 1000);
    if (!allowed) throw new AppError(ErrorCode.RATE_LIMITED, 429);

    const maxPlayers = input.maxPlayers ?? 4;
    if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
      throw badRequest("maxPlayers out of range");
    }

    const now = this.now();
    const room: Room = {
      code: generateRoomCode(),
      hostUserId: user.id,
      isPublic: input.isPublic,
      isQuickplay: input.isQuickplay,
      status: "WAITING",
      maxPlayers,
      settings: { ...DEFAULT_ROOM_SETTINGS, ...input.settings },
      createdAt: now,
      closedAt: null,
    };

    try {
      await this.d.rooms.insert(room);
    } catch {
      // The unique constraint fired: this code exists. Retry with a fresh one.
      room.code = generateRoomCode();
      await this.d.rooms.insert(room);
    }

    const member: RoomMember = {
      roomCode: room.code,
      userId: user.id,
      role: "HOST",
      joinedAt: now,
      leftAt: null,
    };
    const seat = await this.d.members.insertGuarded(member, room.maxPlayers);
    if (seat === "DUPLICATE") {
      throw badRequest("already in room"); // cannot happen for a fresh room; defensive
    }

    await this.d.events.record("ROOM_CREATED", user.id, room.code, now);
    return this.view(room);
  }

  async join(user: User, rawCode: string): Promise<RoomView> {
    const allowed = await this.d.limiter.check(`join:${user.id}`, JOIN_LIMIT, 60 * 60 * 1000);
    if (!allowed) throw new AppError(ErrorCode.RATE_LIMITED, 429);

    const code = this.normalize(rawCode);
    const room = await this.d.rooms.findByCode(code);
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, 404);
    if (room.closedAt != null || room.status === "CLOSED") throw roomClosed();

    const existing = await this.d.members.findActiveByRoomAndUser(room.code, user.id);
    if (existing) {
      // Idempotent join: returning members get the view, not an error.
      return this.view(room);
    }

    if (room.status !== "WAITING") throw badRequest("game already in progress");

    const member: RoomMember = {
      roomCode: room.code,
      userId: user.id,
      role: "MEMBER",
      joinedAt: this.now(),
      leftAt: null,
    };
    const seat = await this.d.members.insertGuarded(member, room.maxPlayers);
    if (seat === "FULL") throw roomFull();
    if (seat === "DUPLICATE") return this.view(room);

    await this.d.events.record("ROOM_JOINED", user.id, room.code, this.now());
    const view = await this.view(room);
    await this.notifyRoom(room.code, "PLAYER_JOINED", user.id);
    return view;
  }

  /**
   * Quick-play: look for an existing public waiting quickplay room with a free seat
   * that is at least `waitMs` old (gives creators a window, avoids self-pairing);
   * otherwise create a fresh quickplay room (a "ticket"). Never pairs two rooms.
   */
  async quickplay(user: User, waitMs = 5000): Promise<RoomView> {
    const allowed = await this.d.limiter.check(`qp:${user.id}`, QUICKPLAY_TICKET_LIMIT, 60 * 60 * 1000);
    if (!allowed) throw new AppError(ErrorCode.RATE_LIMITED, 429);

    const waiter = await this.d.rooms.findQuickplayWaiter(
      user.id,
      this.now() - waitMs
    );
    if (waiter) {
      const member: RoomMember = {
        roomCode: waiter.code,
        userId: user.id,
        role: "MEMBER",
        joinedAt: this.now(),
        leftAt: null,
      };
      const seat = await this.d.members.insertGuarded(member, waiter.maxPlayers);
      if (seat === "OK" || seat === "DUPLICATE") {
        return this.view(waiter);
      }
      // Seat filled between read and write; fall through to creating a ticket.
    }

    return this.create(user, { isPublic: true, isQuickplay: true });
  }

  // (leave moved to leaveCore — shared by HTTP and the DO's WS path)

  /**
   * Host-only room start (Phase 6 bridge to the RoomDO). Validates membership
   * and state here, flips status to PLAYING, then hands the caller the options
   * payload it forwards to the DO (which re-resolves the CURRENT member list).
   * The DO does not require this call to have happened — it is authorization,
   * not synchronization.
   */
  async start(user: User, rawCode: string): Promise<StartRoomOptions> {
    const code = this.normalize(rawCode);
    const room = await this.d.rooms.findByCode(code);
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, 404);
    if (room.closedAt != null || room.status === "CLOSED") throw roomClosed();

    const role = await this.d.members.getRole(room.code, user.id);
    if (!role) throw notMember();
    if (role !== "HOST") throw forbidden();
    if (room.status !== "WAITING") throw badRequest("game already in progress");

    const active = await this.d.members.countActive(room.code);
    if (active < MIN_PLAYERS) throw badRequest("need at least 2 players");

    await this.d.rooms.updateStatus(room.code, "PLAYING", null);
    await this.d.events.record("GAME_STARTING", user.id, room.code, this.now());

    return {
      roomCode: room.code,
      hostUserId: room.hostUserId,
      maxPlayers: room.maxPlayers,
      settings: { ...DEFAULT_ROOM_SETTINGS, ...room.settings },
    };
  }

  /**
   * Service-side leave for a user we have ALREADY authenticated (the DO calls
   * this on WS LEAVE): no rate limit, no re-authorization. Applies identical
   * host-migration / room-closing rules as leave().
   */
  async leaveById(userId: string, rawCode: string): Promise<{ roomClosed: boolean }> {
    return this.leaveCore(userId, this.normalize(rawCode));
  }

  async leave(user: User, rawCode: string): Promise<{ roomClosed: boolean }> {
    return this.leaveCore(user.id, this.normalize(rawCode));
  }

  private async leaveCore(userId: string, code: string): Promise<{ roomClosed: boolean }> {
    const room = await this.d.rooms.findByCode(code);
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, 404);

    const m = await this.d.members.findActiveByRoomAndUser(room.code, userId);
    if (!m) throw notMember();

    const { wasHost, remaining } = await this.d.members.markLeft(room.code, userId, this.now());

    if (wasHost && remaining > 0) {
      const active = await this.d.members.listActiveByRoom(room.code);
      const next = active[0];
      if (next) {
        await this.d.members.updateRole(room.code, next.userId, "HOST");
        await this.d.rooms.updateHost(room.code, next.userId);
        await this.d.events.record("HOST_MIGRATED", next.userId, room.code, this.now());
      }
    }

    let closed = false;
    if (remaining === 0) {
      await this.d.rooms.updateStatus(room.code, "CLOSED", this.now());
      await this.d.events.record("ROOM_CLOSED", userId, room.code, this.now());
      closed = true;
    }
    if (!closed) {
      await this.notifyRoom(room.code, "PLAYER_LEFT", userId);
    }
    return { roomClosed: closed };
  }

  /**
   * Post-start membership change (join/leave while PLAYING) notifies the RoomDO
   * so it can fan out PLAYER_JOINED / PLAYER_LEFT events. Best-effort: the DO
   * re-verifies everything it cares about.
   */
  async notifyRoom(code: string, kind: "PLAYER_JOINED" | "PLAYER_LEFT", userId: string): Promise<void> {
    const normalized = this.normalize(code);
    const room = await this.d.rooms.findByCode(normalized);
    if (!room || room.closedAt != null) return;
    try {
      const stub = this.d.roomStub?.(room.code);
      if (!stub) return;
      const roomView = await this.view(room);
      await stub.fetch("https://room.internal/notify", {
        method: "POST",
        body: JSON.stringify({ kind, userId, room: roomView }),
        headers: { "content-type": "application/json" },
      });
    } catch {
      // Never fail the HTTP request because a lobby notification failed.
    }
  }

  async getRoomIfMember(user: User, rawCode: string): Promise<RoomView> {
    const code = this.normalize(rawCode);
    const room = await this.d.rooms.findByCode(code);
    if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, 404);
    const role = await this.d.members.getRole(room.code, user.id);
    if (!role) throw notMember();
    return this.view(room);
  }

  async listMyRooms(user: User): Promise<RoomView[]> {
    const memberships = await this.d.members.listActiveByUser(user.id);
    const out: RoomView[] = [];
    for (const m of memberships) {
      const room = await this.d.rooms.findByCode(m.roomCode);
      if (room) out.push(await this.view(room));
    }
    return out;
  }

  private normalize(raw: string): string {
    return raw.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 6);
  }

  /** Compose a full room view; shared with markWaiting (DO round-end callback). */
  async composeRoomView(code: string): Promise<RoomView | null> {
    const room = await this.d.rooms.findByCode(code);
    if (!room) return null;
    return this.view(room);
  }

  /** Round ended in the DO: flip the room back to WAITING for a rematch. */
  async markWaiting(code: string): Promise<RoomView | null> {
    const normalized = this.normalize(code);
    const room = await this.d.rooms.findByCode(normalized);
    if (!room || room.closedAt != null) return null;
    if (room.status === "PLAYING") {
      await this.d.rooms.updateStatus(normalized, "WAITING", null);
      room.status = "WAITING";
    }
    return this.view(room);
  }

  private async view(room: Room): Promise<RoomView> {
    const members = await this.d.members.listActiveByRoom(room.code);
    const views = [] as RoomView["members"];
    for (const m of members) {
      const u = await this.d.users.findById(m.userId);
      if (!u) continue;
      views.push({
        userId: u.id,
        handle: u.handle,
        displayName: u.displayName,
        avatarId: u.avatarId,
        role: m.role,
        isHost: m.role === "HOST",
      });
    }
    return {
      code: room.code,
      hostUserId: room.hostUserId,
      isPublic: room.isPublic,
      status: room.status,
      maxPlayers: room.maxPlayers,
      settings: room.settings,
      members: views,
    };
  }
}
