/**
 * Chat and moderation domain types.
 */

export const MAX_CHAT_LENGTH = 280;
export const CHAT_RATE_LIMIT = 5; // 5 messages per 10 seconds
export const CHAT_RATE_WINDOW_MS = 10_000;

export interface ChatMessage {
  id: string;
  roomCode: string;
  senderUserId: string;
  senderName: string;
  body: string;
  createdAt: number;
}

export interface Block {
  blockerUserId: string;
  blockedUserId: string;
  createdAt: number;
}

export type ReportCategory = "HARASSMENT" | "CHEATING" | "SPAM" | "OFFENSIVE" | "OTHER";

export interface Report {
  id: string;
  reporterUserId: string;
  targetUserId: string;
  roomCode: string | null;
  category: ReportCategory;
  messageId: string | null;
  reason: string | null;
  createdAt: number;
  status: "PENDING" | "RESOLVED" | "DISMISSED";
}
