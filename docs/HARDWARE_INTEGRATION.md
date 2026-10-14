# Hardware Integration Plan

The first version is simulation-first because physical hardware has not yet been purchased. The device page lists the future integration path and clearly labels every component as planned.

## Target components

- ESP32 controller
- GPS module
- MPU6050 accelerometer/gyroscope
- Heart-rate sensor
- Buzzer for local feedback
- GSM, Wi-Fi, or Bluetooth communication module

## Integration sequence

1. Read sensor values on the ESP32 at a bounded sampling frequency.
2. Normalize readings into the documented JSON telemetry shape.
3. Authenticate the device and send telemetry over encrypted transport.
4. Validate and persist readings on the backend.
5. Run the transparent scoring engine and return the explanation.
6. Add retries, offline buffering, device clock handling, and battery-aware sampling.
7. Perform consent, privacy, safety, and failure-mode testing before connecting real contacts.

## What is intentionally not implemented

The current code does not claim that an ESP32, GPS module, motion sensor, heart-rate sensor, buzzer, or communication module is connected. It also does not send real SMS, share actual location, or contact emergency services.
