export type UserState = "ACTIVE" | "BANNED";

export interface User {
  id: string;
  handle: string;
  displayName: string;
  avatarId: number;
  isGuest: boolean;
  state: UserState;
  createdAt: number; // ms
  lastSeenAt: number; // ms
}

export interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: number; // ms
  revokedAt: number | null;
  createdAt: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // epoch seconds
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatarId: number;
  isGuest: boolean;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    avatarId: u.avatarId,
    isGuest: u.isGuest,
  };
}
