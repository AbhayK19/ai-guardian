import { describe, expect, it } from "vitest";
import {
  buildEmergencyNotificationPlan,
  getEnabledContactsSorted,
  validateProfile,
  validateProfilePhone,
} from "./phase4";

describe("Phase 4 safety profile helpers", () => {
  it("rejects malformed phone numbers and invalid email", () => {
    const result = validateProfile({
      fullName: "Alex Rivera",
      displayName: "Alex",
      email: "not-an-email",
      phone: "abc",
      age: 21,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.email).toContain("valid email");
    expect(result.errors.phone).toContain("reasonable phone");
  });

  it("keeps enabled contacts sorted by priority and warns when none are available", () => {
    const contacts = [
      { id: "2", name: "Father", phone: "+91 99999 99999", enabled: true, priority: "SECONDARY" },
      { id: "1", name: "Mother", phone: "+91 88888 88888", enabled: true, priority: "PRIMARY" },
      { id: "3", name: "Friend", phone: "+91 77777 77777", enabled: false, priority: "TERTIARY" },
    ];

    expect(getEnabledContactsSorted(contacts).map(c => c.id)).toEqual(["1", "2"]);

    const plan = buildEmergencyNotificationPlan([]);
    expect(plan.warning).toContain("NO EMERGENCY CONTACTS CONFIGURED");
    expect(plan.recipients).toHaveLength(0);
  });

  it("accepts numeric phone values and uses a friendly local format check", () => {
    expect(validateProfilePhone("+1 (415) 555-0102")).toBe(true);
    expect(validateProfilePhone("123456")).toBe(false);
  });
});
