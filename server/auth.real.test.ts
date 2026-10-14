import { describe, expect, it } from "vitest";
import { createAuthService, verifyPasswordHash } from "./auth";

describe("auth service foundation", () => {
  it("registers a user and verifies the resulting password hash", async () => {
    const auth = createAuthService();
    const user = await auth.register({
      name: "Ava Smith",
      email: "ava@example.com",
      password: "StrongPass!123",
    });

    expect(user.email).toBe("ava@example.com");
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe("StrongPass!123");
    expect(await verifyPasswordHash("StrongPass!123", user.passwordHash)).toBe(true);
  });

  it("rejects invalid credentials with a clear error", async () => {
    const auth = createAuthService();
    await auth.register({
      name: "Test User",
      email: "login@example.com",
      password: "SecurePass!123",
    });

    await expect(
      auth.login({ email: "login@example.com", password: "wrong-password" })
    ).rejects.toThrow(/invalid|password/i);
  });
});
