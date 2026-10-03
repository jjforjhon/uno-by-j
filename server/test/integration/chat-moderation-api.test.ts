import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF } from "cloudflare:test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

interface TokenPair {
  user: { id: string; handle: string; displayName: string };
  accessToken: string;
  refreshToken: string;
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

describe("Moderation REST Endpoints", () => {
  it("blocks, lists, and unblocks target users", async () => {
    const alice = await guest("Alice");
    const bob = await guest("Bob");

    // 1. Initial blocks list is empty
    const resInitial = await SELF.fetch("https://example.com/blocks", {
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(resInitial.status).toBe(200);
    const initialList = (await resInitial.json()) as { blockedUserIds: string[] };
    expect(initialList.blockedUserIds).toEqual([]);

    // 2. Block Bob
    const resBlock = await SELF.fetch("https://example.com/block", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${alice.accessToken}`,
      },
      body: JSON.stringify({ targetUserId: bob.user.id }),
    });
    expect(resBlock.status).toBe(200);
    await resBlock.text();

    // 3. Alice's blocks list now includes Bob
    const resList = await SELF.fetch("https://example.com/blocks", {
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(resList.status).toBe(200);
    const updatedList = (await resList.json()) as { blockedUserIds: string[] };
    expect(updatedList.blockedUserIds).toContain(bob.user.id);

    // 4. Cannot block self
    const resSelf = await SELF.fetch("https://example.com/block", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${alice.accessToken}`,
      },
      body: JSON.stringify({ targetUserId: alice.user.id }),
    });
    expect(resSelf.status).toBe(400);
    await resSelf.text();

    // 5. Unblock Bob
    const resUnblock = await SELF.fetch(`https://example.com/block/${bob.user.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(resUnblock.status).toBe(200);
    await resUnblock.text();

    // 6. Blocks list is empty again
    const resFinal = await SELF.fetch("https://example.com/blocks", {
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(resFinal.status).toBe(200);
    const finalList = (await resFinal.json()) as { blockedUserIds: string[] };
    expect(finalList.blockedUserIds).toEqual([]);
  });

  it("submits moderation report with validation", async () => {
    const alice = await guest("Reporter");
    const offender = await guest("Offender");

    // Invalid category
    const resInvalid = await SELF.fetch("https://example.com/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${alice.accessToken}`,
      },
      body: JSON.stringify({
        targetUserId: offender.user.id,
        category: "INVALID_CAT",
      }),
    });
    expect(resInvalid.status).toBe(400);
    await resInvalid.text();

    // Valid report
    const resValid = await SELF.fetch("https://example.com/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${alice.accessToken}`,
      },
      body: JSON.stringify({
        targetUserId: offender.user.id,
        category: "HARASSMENT",
        reason: "Harassing players in game chat",
      }),
    });
    expect(resValid.status).toBe(201);
    const body = (await resValid.json()) as { ok: boolean; reportId: string };
    expect(body.ok).toBe(true);
    expect(body.reportId).toMatch(/^rep_/);
  });
});
