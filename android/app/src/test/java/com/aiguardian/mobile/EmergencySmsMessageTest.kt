package com.aiguardian.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EmergencySmsMessageTest {
    @Test
    fun includesIncidentTimeAndActualMapCoordinates() {
        val message = EmergencySmsMessage.create(
            incidentType = "SOS",
            timestamp = "2026-10-14T06:00:00Z",
            latitude = 12.971600,
            longitude = 77.594600,
            accuracyMeters = 8.5f,
            locationTimestamp = "2026-10-14T05:59:58Z",
            stale = false,
        )

        assertTrue(message.contains("Incident: SOS"))
        assertTrue(message.contains("Time: 2026-10-14T06:00:00Z"))
        assertTrue(message.contains("https://maps.google.com/?q=12.971600,77.594600"))
        assertTrue(message.contains("accuracy ±9 m"))
        assertFalse(message.contains("stale"))
    }

    @Test
    fun makesMissingLocationExplicit() {
        val message = EmergencySmsMessage.create(
            incidentType = "SOS",
            timestamp = "2026-10-14T06:00:00Z",
            latitude = null,
            longitude = null,
            accuracyMeters = null,
            locationTimestamp = null,
            stale = false,
        )

        assertTrue(message.contains("Location unavailable"))
        assertFalse(message.contains("maps.google.com"))
    }

    @Test
    fun labelsOldLocationAsStale() {
        val message = EmergencySmsMessage.create(
            incidentType = "SOS",
            timestamp = "2026-10-14T06:00:00Z",
            latitude = 12.9,
            longitude = 77.5,
            accuracyMeters = null,
            locationTimestamp = "2026-10-14T05:00:00Z",
            stale = true,
        )

        assertTrue(message.contains("Last reported location (stale)"))
    }
}
