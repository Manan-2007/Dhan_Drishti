import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createDb } from "../src/db/index.js";
import { registerUser, createSession, getSessionUser, deleteExpiredSessions } from "../src/auth/service.js";
import { sessions } from "../src/db/schema.js";

describe("deleteExpiredSessions", () => {
  it("removes expired sessions and leaves valid ones intact", async () => {
    const { db } = await createDb(":memory:");
    const user = await registerUser(db, { username: "pruneuser", password: "supersecret1" });

    const validId = await createSession(db, user.id, 30); // expires 30 days out
    const expiredId = randomBytes(16).toString("hex");
    await db
      .insert(sessions)
      .values({ id: expiredId, userId: user.id, expiresAt: new Date(Date.now() - 86_400_000).toISOString() })
      .run();

    expect(await db.select().from(sessions).all()).toHaveLength(2);

    const removed = await deleteExpiredSessions(db);
    expect(removed).toBe(1);

    const rows = await db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(validId);
    // The valid session still authenticates; the expired one is gone.
    expect(await getSessionUser(db, validId)).not.toBeNull();
    expect(await getSessionUser(db, expiredId)).toBeNull();
  });
});
