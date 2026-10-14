import { afterEach, describe, expect, it } from "vitest";
import { readPhase4Store, writePhase4Store } from "./phase4";

const original = readPhase4Store();

afterEach(() => writePhase4Store(original));

describe("Phase 4 local persistence", () => {
  it("round-trips profile, contacts, settings, device, and incident data", () => {
    const next = readPhase4Store();
    next.profile = { ...next.profile, displayName: "Restarted Alex" };
    next.contacts = [{ ...next.contacts[0], name: "Primary Contact" }];
    next.safetySettings = { ...next.safetySettings, safetyVerificationTimer: 30 };
    next.alertSettings = { ...next.alertSettings, sound: false, vibration: false };
    next.device = { ...next.device, deviceName: "Restart Test Band", connectionStatus: "Disconnected" };
    next.incidents = [{
      id: "AG-persistence-test",
      eventType: "Fall",
      riskLevel: "HIGH RISK",
      riskScore: 84,
      timestamp: new Date().toISOString(),
      locationStatus: "Simulated location captured",
      userResponse: "No response / help requested",
      resolution: "Emergency response simulation complete",
      responseStatus: "Emergency response completed",
      notificationStatus: "Demo notification prepared",
      emergencyContacts: ["Primary Contact"],
      trigger: "Fall escalation",
      location: "16.7049, 74.2433",
      sensorSummary: "112 BPM · Inactivity after impact · acceleration 5.9 g",
      detectionFactors: ["Fall-like pattern"],
    }];

    writePhase4Store(next);
    const restarted = readPhase4Store();

    expect(restarted.profile.displayName).toBe("Restarted Alex");
    expect(restarted.contacts[0]?.name).toBe("Primary Contact");
    expect(restarted.safetySettings.safetyVerificationTimer).toBe(30);
    expect(restarted.alertSettings.sound).toBe(false);
    expect(restarted.alertSettings.vibration).toBe(false);
    expect(restarted.device.deviceName).toBe("Restart Test Band");
    expect(restarted.incidents[0]?.id).toBe("AG-persistence-test");
  });
});
