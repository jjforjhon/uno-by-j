/** Stable, client-visible error codes (see docs/PROTOCOL.md). Never embed internals. */
export const ErrorCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  BAD_REQUEST: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_FULL: "ROOM_FULL",
  ROOM_CLOSED: "ROOM_CLOSED",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  NOT_MEMBER: "NOT_MEMBER",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  BANNED: "BANNED",
  SERVER_BUSY: "SERVER_BUSY",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;

  constructor(code: ErrorCodeValue, httpStatus: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export const authRequired = () => new AppError(ErrorCode.AUTH_REQUIRED, 401);
export const authExpired = () => new AppError(ErrorCode.AUTH_EXPIRED, 401);
export const badRequest = (msg?: string) => new AppError(ErrorCode.BAD_REQUEST, 400, msg);
export const rateLimited = () => new AppError(ErrorCode.RATE_LIMITED, 429);
export const banned = () => new AppError(ErrorCode.BANNED, 403);
export const notFoundError = (code: ErrorCodeValue = ErrorCode.NOT_FOUND) =>
  new AppError(code, 404);
export const roomNotFound = () => notFoundError(ErrorCode.ROOM_NOT_FOUND);
export const roomFull = () => new AppError(ErrorCode.ROOM_FULL, 409);
export const roomClosed = () => new AppError(ErrorCode.ROOM_CLOSED, 409);
export const alreadyMember = () => new AppError(ErrorCode.ALREADY_MEMBER, 409);
export const notMember = () => new AppError(ErrorCode.NOT_MEMBER, 403);
export const forbidden = () => new AppError(ErrorCode.FORBIDDEN, 403);
