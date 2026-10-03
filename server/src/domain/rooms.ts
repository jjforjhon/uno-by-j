export interface RoomSettings {
  matchMode: boolean;        // first to 500
  stacking: boolean;         // +2/+4 stacking (documented deviation, default off)
  turnTimeoutS: number;      // 30 default
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  matchMode: false,
  stacking: false,
  turnTimeoutS: 0,
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export type RoomStatus = "WAITING" | "PLAYING" | "CLOSED";
export type MemberRole = "HOST" | "MEMBER";

export interface Room {
  code: string;
  hostUserId: string;
  isPublic: boolean;
  isQuickplay: boolean;
  status: RoomStatus;
  maxPlayers: number;
  settings: RoomSettings;
  createdAt: number;
  closedAt: number | null;
}

export interface RoomMember {
  roomCode: string;
  userId: string;
  role: MemberRole;
  joinedAt: number;
  leftAt: number | null;
}

export interface RoomMemberView {
  userId: string;
  handle: string;
  displayName: string;
  avatarId: number;
  role: MemberRole;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  hostUserId: string;
  isPublic: boolean;
  status: RoomStatus;
  maxPlayers: number;
  settings: RoomSettings;
  members: RoomMemberView[];
}

export function newRoomView(
  room: Room,
  members: RoomMemberView[]
): RoomView {
  return {
    code: room.code,
    hostUserId: room.hostUserId,
    isPublic: room.isPublic,
    status: room.status,
    maxPlayers: room.maxPlayers,
    settings: room.settings,
    members,
  };
}

/**
 * Everything the RoomDO needs to start a round (Phase 6 bridge payload).
 * Deliberately excludes membership (re-resolved live in the DO — it must be
 * current at start time, not at HTTP-request time).
 */
export interface StartRoomOptions {
  roomCode: string;
  hostUserId: string;
  maxPlayers: number;
  settings: RoomSettings;
}
