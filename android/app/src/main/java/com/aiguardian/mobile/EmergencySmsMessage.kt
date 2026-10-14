package com.aiguardian.mobile

import java.util.Locale
import kotlin.math.roundToInt

internal object EmergencySmsMessage {
    fun create(
        incidentType: String,
        timestamp: String,
        latitude: Double?,
        longitude: Double?,
        accuracyMeters: Float?,
        locationTimestamp: String?,
        stale: Boolean,
    ): String {
        val locationText = if (latitude != null && longitude != null) {
            val locationLabel = if (stale) "Last reported location (stale)" else "Device location"
            val accuracy = accuracyMeters
                ?.takeIf { it.isFinite() && it >= 0 }
                ?.let { " (accuracy ±${it.roundToInt()} m)" }
                .orEmpty()
            val updated = locationTimestamp ?: "time unavailable"
            val mapUrl = String.format(
                Locale.US,
                "https://maps.google.com/?q=%.6f,%.6f",
                latitude,
                longitude,
            )
            "$locationLabel: $mapUrl$accuracy. Location updated at: $updated."
        } else {
            "Location unavailable (permission denied or GPS fix unavailable)."
        }

        return "AI Guardian Emergency Alert\n" +
            "Incident: $incidentType\n" +
            "Time: $timestamp\n" +
            locationText +
            "\nPlease contact me and verify my safety."
    }
}
