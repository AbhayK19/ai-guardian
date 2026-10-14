import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EmergencyContact as EmergencyContactRow,
  User,
} from "../drizzle/schema";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn(),
    listContactsForUser: vi.fn(),
    upsertContactForUser: vi.fn(),
  };
});

import {
  getDb,
  listContactsForUser,
  upsertContactForUser,
} from "./db";
import { appRouter } from "./routers";

const contact: EmergencyContactRow = {
  id: 12,
  userId: 42,
  name: "Test Contact",
  relationship: "Friend",
  phone: "+919876543210",
  priority: 1,
  enabled: 1,
  notificationPreference: "SMS",
  phoneVerifiedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

function createCaller(user: User | null) {
  return appRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user,
  });
}

function createUser(id: number): User {
  const now = new Date("2026-10-01T00:00:00Z");
  return {
    id,
    openId: `contact-test-${id}`,
    name: null,
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

describe("emergency contact database ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(
      {} as NonNullable<Awaited<ReturnType<typeof getDb>>>
    );
  });

  it("lists only contacts belonging to the authenticated user", async () => {
    vi.mocked(listContactsForUser).mockResolvedValue([contact]);

    const result = await createCaller(createUser(42)).contacts.list();

    expect(listContactsForUser).toHaveBeenCalledWith(42);
    expect(result).toMatchObject([{ id: "12", name: "Test Contact" }]);
  });

  it("creates a contact for the authenticated user", async () => {
    vi.mocked(upsertContactForUser).mockResolvedValue(contact);

    const result = await createCaller(createUser(42)).contacts.create({
      name: "Test Contact",
      relationship: "Friend",
      phone: "+919876543210",
      priority: "PRIMARY",
      enabled: true,
    });

    expect(upsertContactForUser).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ phone: "+919876543210" })
    );
    expect(result).toMatchObject({ id: "12", name: "Test Contact" });
  });

  it("does not read database contacts without an authenticated user", async () => {
    await createCaller(null).contacts.list();

    expect(listContactsForUser).not.toHaveBeenCalled();
  });
});
