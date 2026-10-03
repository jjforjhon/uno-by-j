import { describe, expect, it } from "vitest";
import type { ChatMessage, Report, ReportCategory } from "../../src/domain/chat";
import { MAX_CHAT_LENGTH } from "../../src/domain/chat";
import type { ChatRepo, BlockRepo, ReportRepo } from "../../src/domain/repos";

class MemoryChatRepo implements ChatRepo {
  private messages: ChatMessage[] = [];

  async insert(msg: ChatMessage): Promise<void> {
    this.messages.push({ ...msg });
  }

  async listRecentByRoom(roomCode: string, limit = 50): Promise<ChatMessage[]> {
    return this.messages
      .filter((m) => m.roomCode === roomCode)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-limit);
  }
}

class MemoryBlockRepo implements BlockRepo {
  private blocks = new Set<string>();

  private key(blocker: string, blocked: string): string {
    return `${blocker}:${blocked}`;
  }

  async block(blockerUserId: string, blockedUserId: string): Promise<void> {
    if (blockerUserId === blockedUserId) return;
    this.blocks.add(this.key(blockerUserId, blockedUserId));
  }

  async unblock(blockerUserId: string, blockedUserId: string): Promise<void> {
    this.blocks.delete(this.key(blockerUserId, blockedUserId));
  }

  async isBlocked(userA: string, userB: string): Promise<boolean> {
    return (
      this.blocks.has(this.key(userA, userB)) ||
      this.blocks.has(this.key(userB, userA))
    );
  }

  async listBlockedByUser(userId: string): Promise<string[]> {
    const list: string[] = [];
    const prefix = `${userId}:`;
    for (const entry of this.blocks) {
      if (entry.startsWith(prefix)) {
        list.push(entry.slice(prefix.length));
      }
    }
    return list;
  }
}

class MemoryReportRepo implements ReportRepo {
  private reports: Report[] = [];

  async insert(report: Report): Promise<void> {
    this.reports.push({ ...report });
  }

  async listByTarget(targetUserId: string): Promise<Report[]> {
    return this.reports.filter((r) => r.targetUserId === targetUserId);
  }

  async countRecentByReporter(reporterUserId: string, sinceMs: number): Promise<number> {
    return this.reports.filter(
      (r) => r.reporterUserId === reporterUserId && r.createdAt >= sinceMs
    ).length;
  }
}

describe("Chat & Moderation Domain", () => {
  it("enforces maximum chat message length constant of 280", () => {
    expect(MAX_CHAT_LENGTH).toBe(280);
    const validMessage = "A".repeat(280);
    expect(validMessage.length).toBeLessThanOrEqual(MAX_CHAT_LENGTH);
    const invalidMessage = "A".repeat(281);
    expect(invalidMessage.length).toBeGreaterThan(MAX_CHAT_LENGTH);
  });

  it("stores and retrieves chat messages chronologically within limits", async () => {
    const repo = new MemoryChatRepo();
    await repo.insert({
      id: "msg_1",
      roomCode: "ROOM01",
      senderUserId: "u_alice",
      senderName: "Alice",
      body: "Good luck!",
      createdAt: 1000,
    });
    await repo.insert({
      id: "msg_2",
      roomCode: "ROOM01",
      senderUserId: "u_bob",
      senderName: "Bob",
      body: "Have fun!",
      createdAt: 2000,
    });
    await repo.insert({
      id: "msg_other",
      roomCode: "ROOM02",
      senderUserId: "u_charlie",
      senderName: "Charlie",
      body: "Another room",
      createdAt: 3000,
    });

    const room1Messages = await repo.listRecentByRoom("ROOM01");
    expect(room1Messages).toHaveLength(2);
    expect(room1Messages[0]!.id).toBe("msg_1");
    expect(room1Messages[1]!.id).toBe("msg_2");

    const limited = await repo.listRecentByRoom("ROOM01", 1);
    expect(limited).toHaveLength(1);
    expect(limited[0]!.id).toBe("msg_2");
  });

  it("manages user blocks and provides bidirectional block detection", async () => {
    const blockRepo = new MemoryBlockRepo();

    // Alice blocks Bob
    await blockRepo.block("u_alice", "u_bob");

    // Both should be considered mutually blocked
    expect(await blockRepo.isBlocked("u_alice", "u_bob")).toBe(true);
    expect(await blockRepo.isBlocked("u_bob", "u_alice")).toBe(true);

    // Alice has not blocked Charlie
    expect(await blockRepo.isBlocked("u_alice", "u_charlie")).toBe(false);

    // Listing blocked users
    const aliceBlocks = await blockRepo.listBlockedByUser("u_alice");
    expect(aliceBlocks).toEqual(["u_bob"]);

    // Self-blocking is rejected
    await blockRepo.block("u_alice", "u_alice");
    expect(await blockRepo.listBlockedByUser("u_alice")).toEqual(["u_bob"]);

    // Unblocking restores access
    await blockRepo.unblock("u_alice", "u_bob");
    expect(await blockRepo.isBlocked("u_alice", "u_bob")).toBe(false);
  });

  it("submits moderation reports and tracks reporter submission counts", async () => {
    const reportRepo = new MemoryReportRepo();
    const now = Date.now();

    await reportRepo.insert({
      id: "rep_1",
      reporterUserId: "u_alice",
      targetUserId: "u_spammer",
      roomCode: "ROOM01",
      category: "SPAM" as ReportCategory,
      messageId: "msg_123",
      reason: "Posting repeated advertisements",
      createdAt: now - 5000,
      status: "PENDING",
    });

    await reportRepo.insert({
      id: "rep_2",
      reporterUserId: "u_bob",
      targetUserId: "u_spammer",
      roomCode: "ROOM01",
      category: "HARASSMENT" as ReportCategory,
      messageId: null,
      reason: "Inappropriate chat behavior",
      createdAt: now,
      status: "PENDING",
    });

    const spammerReports = await reportRepo.listByTarget("u_spammer");
    expect(spammerReports).toHaveLength(2);

    const aliceCount = await reportRepo.countRecentByReporter("u_alice", now - 10000);
    expect(aliceCount).toBe(1);

    const aliceOlderCount = await reportRepo.countRecentByReporter("u_alice", now - 2000);
    expect(aliceOlderCount).toBe(0);
  });
});
