import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  assessRisk,
  detectFallEvidence,
  getSafetyWindowSeconds,
  scenarioTelemetry,
  type TelemetryInput,
} from "./risk-engine";

function caller() {
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("AI Guardian risk engine", () => {
  it("switches scenarios and exposes explainable factors", async () => {
    const api = caller();
    const result = await api.simulation.scenario({ scenario: "fall" });
    expect(result.scenario).toBe("fall");
    expect(result.risk.score).toBe(84);
    expect(result.risk.factors).toContain("Fall-like pattern");

    const current = await api.risk.current();
    expect(current.level).toBe("HIGH RISK");
    expect(current.medicallyValidated).toBe(false);
  });

  it("adds transparent modifiers to validated sensor inputs", async () => {
    const api = caller();
    const result = await api.risk.analyze({
      heartRate: 138,
      acceleration: 6.7,
      gyro: 5.4,
      fallDetected: true,
      scenario: "emergency",
    });
    expect(result.transparent).toBe(true);
    expect(result.model).toBe("rule-based-v1");
    expect(result.score).toBe(100);
  });

  it("ingests telemetry into a bounded risk history and creates an incident", async () => {
    const api = caller();
    await api.simulation.reset();
    const scenario = await api.simulation.scenario({ scenario: "fall" });
    expect(scenario.risk.score).toBe(84);
    const history = await api.sensors.history();
    expect(history.length).toBeGreaterThan(1);

    const emergency = await api.emergency.activate();
    expect(emergency.incident.responseStatus).toBe("Simulation active");
    const incidents = await api.incidents.list();
    expect(incidents[0]?.score).toBe(84);
  });

  it("records a cancelled emergency without marking it as sent", async () => {
    const api = caller();
    const cancelled = await api.emergency.cancel({
      reason: "Countdown cancelled",
    });
    expect(cancelled.incident.responseStatus).toBe(
      "Cancelled before confirmation"
    );
  });

  it("requires multi-signal evidence before declaring a fall", () => {
    const normalReading: TelemetryInput = scenarioTelemetry("normal");
    normalReading.accelX = 4.4;
    normalReading.accelY = 3.8;
    normalReading.accelZ = 4.9;
    normalReading.gyroX = 1.5;
    normalReading.gyroY = 1.2;
    normalReading.gyroZ = 1.7;
    normalReading.movement = "Abnormal";
    normalReading.fallDetected = false;

    const detected = detectFallEvidence(normalReading, [normalReading]);
    expect(detected.isLikelyFall).toBe(false);

    const actualFall: TelemetryInput = scenarioTelemetry("fall");
    actualFall.movement = "Inactivity after impact";
    actualFall.fallDetected = true;
    const fallEvidence = detectFallEvidence(actualFall, [actualFall]);
    expect(fallEvidence.isLikelyFall).toBe(true);
    expect(fallEvidence.factors).toContain("fall-like movement");
  });

  it("uses a shorter safety window for severe events and keeps the safety period configurable", () => {
    const severeReading: TelemetryInput = scenarioTelemetry("emergency");
    severeReading.accelX = 4.5;
    severeReading.accelY = 4.2;
    severeReading.accelZ = 4.8;
    severeReading.gyroX = 3.8;
    severeReading.gyroY = 3.4;
    severeReading.gyroZ = 4.4;
    severeReading.heartRate = 138;
    severeReading.fallDetected = true;
    severeReading.movement = "Critical pattern";
    const severe = detectFallEvidence(severeReading, [severeReading]);
    expect(severe.isSevereEvent).toBe(true);
    expect(getSafetyWindowSeconds(severeReading, [severeReading])).toBe(10);

    const normalReading: TelemetryInput = scenarioTelemetry("fall");
    normalReading.accelX = 2.6;
    normalReading.accelY = 2.8;
    normalReading.accelZ = 3.4;
    normalReading.gyroX = 1.9;
    normalReading.gyroY = 1.4;
    normalReading.gyroZ = 2.2;
    normalReading.heartRate = 110;
    normalReading.fallDetected = true;
    normalReading.movement = "Inactivity after impact";
    expect(getSafetyWindowSeconds(normalReading, [normalReading])).toBe(20);
  });

  it("will not down-rank a fall event to safe when multiple signals align", () => {
    const reading: TelemetryInput = scenarioTelemetry("fall");
    reading.heartRate = 115;
    reading.accelX = 4.1;
    reading.accelY = 3.6;
    reading.accelZ = 4.5;
    reading.gyroX = 2.9;
    reading.gyroY = 2.5;
    reading.gyroZ = 3.2;
    reading.movement = "Inactivity after impact";
    reading.fallDetected = true;

    const assessment = assessRisk(reading, [reading]);
    expect(assessment.riskLevel).toBe("HIGH RISK");
    expect(assessment.riskScore).toBeGreaterThanOrEqual(80);
  });
});
