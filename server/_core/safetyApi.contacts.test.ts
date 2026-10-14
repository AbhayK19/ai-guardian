import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { Pool } from "mysql2/promise";

vi.mock("../db", () => ({ getMysqlPool: vi.fn() }));
vi.mock("./context", () => ({
  createContext: vi.fn(async () => ({
    user: { id: 7, openId: "contact-test-user" },
  })),
}));

import { getMysqlPool } from "../db";
import { registerSafetyApiRoutes } from "./safetyApi";

describe("trusted emergency contacts", () => {
  let server: Server;
  let baseUrl: string;
  let inserted: unknown[] | undefined;
  let existingPhone = "+919876543210";
  let existingEnabled = 1;
  let existingVerifiedAt: Date | null = new Date("2026-10-01T00:00:00Z");

  const pool = {
    execute: vi.fn(async (query: string, values: unknown[] = []) => {
      if (query.includes("INSERT INTO emergencyContacts")) {
        inserted = values;
        return [{ insertId: 17 }, []];
      }
      if (query.includes("SELECT id, name, relationship, phone, priority, enabled, phoneVerifiedAt, createdAt")) {
        if (query.includes("WHERE id=? AND userId=? LIMIT 1")) {
          return [[{
            id: 17,
            name: "Consenting Contact",
            relationship: "Friend",
            phone: existingPhone,
            priority: 1,
            enabled: existingEnabled,
            phoneVerifiedAt: existingVerifiedAt,
            createdAt: new Date("2026-10-01T00:00:00Z"),
          }], []];
        }
        return [[{
          id: 17,
          name: String(inserted?.[1]),
          relationship: String(inserted?.[2]),
          phone: String(inserted?.[3]),
          priority: Number(inserted?.[4]),
          enabled: Number(inserted?.[5]),
          phoneVerifiedAt: null,
          createdAt: new Date("2026-10-01T00:00:00Z"),
        }], []];
      }
      if (query.includes("UPDATE emergencyContacts SET")) {
        existingPhone = String(values[2]);
        existingEnabled = Number(values[4]);
        existingVerifiedAt = values[5] as Date | null;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL in contact test: ${query}`);
    }),
  } as unknown as Pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    inserted = undefined;
    existingPhone = "+919876543210";
    existingEnabled = 1;
    existingVerifiedAt = new Date("2026-10-01T00:00:00Z");
    vi.mocked(getMysqlPool).mockResolvedValue(pool);

    const app = express();
    app.use(express.json());
    registerSafetyApiRoutes(app);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test HTTP server did not bind to a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  });

  async function post(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("creates a trusted contact without marking its phone as verified", async () => {
    const response = await post("/api/safety/contacts", {
      name: "Consenting Contact",
      relationship: "Friend",
      phone: "+919876543210",
      priority: 1,
      enabled: true,
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      trusted: true,
      phoneVerifiedAt: null,
      message: expect.stringContaining("remains unverified"),
    });
    expect(inserted?.[5]).toBe(1);
    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining("phoneVerifiedAt)"),
      expect.arrayContaining([7, "Consenting Contact", "Friend", "+919876543210", 1, 1])
    );
  });

  it("rejects malformed international phone numbers before writing", async () => {
    const response = await post("/api/safety/contacts", {
      name: "Consenting Contact",
      relationship: "Friend",
      phone: "+ 91 98765 43210",
      priority: 1,
      enabled: true,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("international phone number"),
    });
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it("clears verification and trust when a contact phone number changes", async () => {
    const response = await fetch(`${baseUrl}/api/safety/contacts/17`, {
      method: "PATCH",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        phone: "+14155550102",
        enabled: true,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      trusted: false,
      phoneVerifiedAt: null,
      message: expect.stringContaining("trust disabled"),
    });
    expect(existingEnabled).toBe(0);
    expect(existingVerifiedAt).toBeNull();
  });

  it("rejects contact OTP requests without contacting MSG91", async () => {
    const response = await post("/api/auth/otp/send", {
      phone: "+919876543210",
      purpose: "contact",
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("trusted-contact consent"),
    });
    expect(pool.execute).not.toHaveBeenCalled();
  });
});
