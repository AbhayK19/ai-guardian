package com.aiguardian.mobile

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telephony.TelephonyManager
import android.view.Gravity
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max

private data class EmergencyContact(
    val id: Int,
    val name: String,
    val relationship: String,
    val phone: String,
    val enabled: Boolean,
    val phoneVerified: Boolean,
)

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val preferences by lazy { getSharedPreferences("ai_guardian", MODE_PRIVATE) }
    private lateinit var root: LinearLayout
    private lateinit var baseUrlField: EditText
    private var contacts: List<EmergencyContact> = emptyList()
    private var selectedContactId: Int? = null
    private var incidentType = "SOS"
    private var pendingSos = false
    private var countdown = 10
    @Volatile private var incidentId: String? = null
    @Volatile private var pendingSmsStatus: String? = null
    private var lastStatusWritten: String? = null
    private var smsReturnPending = false
    @Volatile private var lastNotice: String? = null

    private val locationTimeout = Runnable {
        continueSosWithoutLocation("Timed out waiting for a fresh location fix.")
    }

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            handler.removeCallbacks(locationTimeout)
            runCatching { getSystemService(LocationManager::class.java).removeUpdates(this) }
            continueSosWithLocation(location)
        }

        @Deprecated("Deprecated by Android; required for older API levels")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = 0xFF10252B.toInt()
        window.navigationBarColor = 0xFF10252B.toInt()
        showHome()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        runCatching { getSystemService(LocationManager::class.java).removeUpdates(locationListener) }
        executor.shutdown()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_PERMISSION_REQUEST || !pendingSos) return
        if (hasLocationPermission()) requestFreshLocation()
        else continueSosWithoutLocation("Location permission was denied; continuing without coordinates.")
    }

    @Deprecated("Activity result used to return from the system SMS composer")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SMS_COMPOSER_REQUEST && smsReturnPending) {
            smsReturnPending = false
            askUserToReportSmsAction()
        }
    }

    private fun showHome(message: String? = lastNotice) {
        lastNotice = message
        val page = newPage()
        page.addView(title("AI Guardian"))
        page.addView(text("Emergency SMS is prepared on this phone. The system SMS app always asks you to confirm sending. Delivery cannot be verified here."))

        page.addView(label("Backend address"))
        baseUrlField = EditText(this).apply {
            setSingleLine(true)
            hint = "https://your-ai-guardian-host"
            setText(preferences.getString("base_url", ""))
            textSize = 15f
        }
        page.addView(baseUrlField, fullWidth())
        page.addView(button("Save backend address") {
            val base = normalizedBaseUrl()
            if (base == null) {
                showNotice("Enter a valid backend URL. Use HTTPS outside local development.")
            } else {
                preferences.edit().putString("base_url", base).apply()
                showNotice("Backend address saved on this device.")
            }
        })
        page.addView(button("Sign in to AI Guardian") { openSignIn() })
        page.addView(button("Emergency contacts") { loadContacts() })
        page.addView(button("SOS") { showSosScreen() })
        page.addView(button("Open website dashboard") {
            val base = normalizedBaseUrl()
            if (base == null) showNotice("Set the backend address first.")
            else runCatching {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(base)))
            }.onFailure { showNotice("No browser is available to open the dashboard.") }
        })
        message?.let { page.addView(text(it)) }
        page.addView(text("No SMS is sent automatically. The app does not request SEND_SMS permission and does not use MSG91 for this feature."))
        setContentView(page)
    }

    private fun showContacts() {
        val page = newPage()
        page.addView(title("Emergency contacts"))
        page.addView(text("Choose one contact you have explicitly marked as trusted in the website dashboard. Trust is your authorization to use the number; it does not mean the phone number has been verified."))
        if (contacts.isEmpty()) {
            page.addView(text("No trusted contact is available. Add and explicitly trust a contact in the website dashboard before starting an SOS."))
        } else {
            val group = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
            contacts.forEach { contact ->
                val option = RadioButton(this).apply {
                    id = android.view.View.generateViewId()
                    text = "${contact.name} · ${contact.relationship}\n${contact.phone}\nTrusted for SOS · phone ${if (contact.phoneVerified) "verified" else "unverified"}"
                    isEnabled = contact.enabled
                    tag = contact.id
                    isChecked = selectedContactId == contact.id
                    setPadding(8, 12, 8, 12)
                }
                group.addView(option)
            }
            group.setOnCheckedChangeListener { _, checkedId ->
                val selected = group.findViewById<RadioButton>(checkedId)
                selectedContactId = selected?.tag as? Int
            }
            page.addView(group)
        }
        page.addView(button("Refresh contacts") { loadContacts() })
        page.addView(button("Open contact manager") {
            val base = normalizedBaseUrl()
            if (base == null) showNotice("Set the backend address first.")
            else runCatching {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$base/")))
            }.onFailure { showNotice("No browser is available.") }
        })
        page.addView(button("Back") { showHome() })
        setContentView(page)
    }

    private fun showSosScreen() {
        val page = newPage()
        page.addView(title("SOS"))
        page.addView(text("Select the incident type. A 10-second countdown gives you time to cancel. After that, the app tries to obtain a fresh phone location and opens the SMS composer for your selected contact."))
        val typePicker = Spinner(this)
        typePicker.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            listOf("SOS", "FALL", "MANUAL_HELP"),
        )
        page.addView(typePicker)
        page.addView(button("Start SOS countdown") {
            incidentType = typePicker.selectedItem?.toString() ?: "SOS"
            startCountdown(page)
        })
        page.addView(button("Choose emergency contact") { showContacts() })
        page.addView(text(selectedContactSummary()))
        page.addView(button("Back") { showHome() })
        setContentView(page)
    }

    private fun startCountdown(page: LinearLayout) {
        if (selectedContactId == null) {
            showNotice("Select a contact you have marked as trusted for SOS first.")
            return
        }
        pendingSos = true
        countdown = 10
        page.removeAllViews()
        page.addView(title("SOS countdown"))
        val counter = text("Preparing SOS in $countdown seconds…")
        page.addView(counter)
        page.addView(button("Cancel SOS") {
            pendingSos = false
            handler.removeCallbacksAndMessages(null)
            showSosScreen()
            showNotice("SOS cancelled. No incident was created and no SMS composer was opened.")
        })
        val tick = object : Runnable {
            override fun run() {
                if (!pendingSos) return
                countdown -= 1
                if (countdown <= 0) {
                    pendingSos = false
                    beginLocationCapture()
                } else {
                    counter.text = "Preparing SOS in $countdown seconds…"
                    handler.postDelayed(this, 1_000)
                }
            }
        }
        handler.postDelayed(tick, 1_000)
    }

    private fun beginLocationCapture() {
        if (!hasLocationPermission()) {
            pendingSos = true
            requestPermissions(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                LOCATION_PERMISSION_REQUEST,
            )
            return
        }
        requestFreshLocation()
    }

    private fun requestFreshLocation() {
        pendingSos = true
        val manager = getSystemService(LocationManager::class.java)
        val hasFine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val provider = when {
            hasFine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> null
        }
        if (provider == null) {
            continueSosWithoutLocation("GPS and network location providers are unavailable.")
            return
        }
        handler.removeCallbacks(locationTimeout)
        handler.postDelayed(locationTimeout, LOCATION_TIMEOUT_MS)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                manager.getCurrentLocation(provider, null, mainExecutor) { location ->
                    handler.removeCallbacks(locationTimeout)
                    if (location == null) continueSosWithoutLocation("The phone returned no fresh location fix.")
                    else continueSosWithLocation(location)
                }
            } else {
                @Suppress("DEPRECATION")
                manager.requestSingleUpdate(provider, locationListener, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            continueSosWithoutLocation("Location permission was not available.")
        } catch (_: IllegalArgumentException) {
            continueSosWithoutLocation("The selected location provider is unavailable.")
        }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun continueSosWithLocation(location: Location) {
        if (!pendingSos) return
        pendingSos = false
        createBackendIncidentThenOpenComposer(location)
    }

    private fun continueSosWithoutLocation(reason: String) {
        if (!pendingSos) return
        pendingSos = false
        handler.removeCallbacks(locationTimeout)
        runCatching { getSystemService(LocationManager::class.java).removeUpdates(locationListener) }
        createBackendIncidentThenOpenComposer(null, reason)
    }

    private fun createBackendIncidentThenOpenComposer(location: Location?, locationProblem: String? = null) {
        incidentId = null
        pendingSmsStatus = null
        lastStatusWritten = null
        val contactId = selectedContactId
        val contact = contacts.firstOrNull { it.id == contactId && it.enabled }
        if (contact == null) {
            showNotice("The selected contact is no longer available. Refresh contacts before trying again.")
            return
        }
        showHome(
            if (locationProblem == null) {
                "Opening the system SMS composer and recording the incident in the background…"
            } else {
                "$locationProblem Opening the SMS composer without coordinates and recording the incident in the background."
            }
        )
        openSmsComposer(
            contact,
            location,
            "Incident recording is in progress; SMS delivery will remain unconfirmed.",
        )
        val body = JSONObject()
            .put("trigger", incidentType)
            .put("contactId", contact.id)
        location?.let {
            body.put(
                "location",
                JSONObject()
                    .put("deviceId", deviceId())
                    .put("latitude", it.latitude)
                    .put("longitude", it.longitude)
                    .put("accuracyMeters", if (it.hasAccuracy()) it.accuracy.toDouble() else JSONObject.NULL)
                    .put("recordedAt", Instant.ofEpochMilli(it.time).toString()),
            )
        }

        executor.execute {
            var recordedId: String? = null
            var serverMessage: String? = null
            try {
                val response = JSONObject(apiRequest("/api/safety/android-sos", "POST", body))
                recordedId = response.optString("incidentId").takeIf { it.isNotBlank() }
                incidentId = recordedId
                serverMessage = if (recordedId == null) {
                    "Incident response was not returned by the backend."
                } else {
                    "Incident recorded as $recordedId."
                }
                pendingSmsStatus?.let { status ->
                    val stored = runCatching {
                        apiRequest(
                            "/api/safety/incidents/$recordedId/android-sms-status",
                            "POST",
                            JSONObject().put("status", status),
                        )
                    }.isSuccess
                    if (stored) lastStatusWritten = status
                }
            } catch (error: Exception) {
                serverMessage = "Backend incident recording failed (${error.message ?: "network unavailable"}). SMS can still be prepared; the incident is not recorded on the website."
            }
            lastNotice = serverMessage
        }
    }

    private fun openSmsComposer(contact: EmergencyContact, location: Location?, backendMessage: String?) {
        val now = Instant.now().toString()
        val stale = location != null && max(0L, System.currentTimeMillis() - location.time) > STALE_LOCATION_MS
        val smsText = EmergencySmsMessage.create(
            incidentType = incidentType,
            timestamp = now,
            latitude = location?.latitude,
            longitude = location?.longitude,
            accuracyMeters = if (location?.hasAccuracy() == true) location.accuracy else null,
            locationTimestamp = location?.let { Instant.ofEpochMilli(it.time).toString() },
            stale = stale,
        )
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
            reportStatus("composer_unavailable")
            showHome("${backendMessage ?: "Incident status unavailable."} This device reports no telephony capability, so SMS cannot be composed.")
            return
        }
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.fromParts("smsto", contact.phone, null)
            putExtra("sms_body", smsText)
        }
        if (intent.resolveActivity(packageManager) == null) {
            reportStatus("composer_unavailable")
            showHome("${backendMessage ?: "Incident status unavailable."} No compatible SMS app is installed.")
            return
        }
        val simWarning = runCatching {
            getSystemService(TelephonyManager::class.java).simState != TelephonyManager.SIM_STATE_READY
        }.getOrDefault(false)
        val readiness = if (simWarning) {
            " Android reports no ready SIM; the carrier may not be able to send."
        } else {
            " A working SIM/carrier plan may be required."
        }
        showHome("${backendMessage ?: "Incident status unavailable."} Review recipient and message in the system SMS app; tap Send only if you choose.$readiness")
        smsReturnPending = true
        try {
            startActivityForResult(intent, SMS_COMPOSER_REQUEST)
            reportStatus("composer_opened")
        } catch (_: Exception) {
            smsReturnPending = false
            reportStatus("composer_unavailable")
            showNotice("Could not open the system SMS app. Nothing was sent.")
        }
    }

    private fun askUserToReportSmsAction() {
        AlertDialog.Builder(this)
            .setTitle("Did you tap Send?")
            .setMessage(
                "The app cannot confirm SMS delivery. Record only what you did in the SMS app.\n\n" +
                    (lastNotice ?: "Backend incident status is not yet available.")
            )
            .setPositiveButton("I tapped Send") { _, _ ->
                reportStatus("user_reported_sent")
                showNotice("Recorded as user-reported sent. Carrier delivery is unconfirmed.")
            }
            .setNegativeButton("I did not send it") { _, _ ->
                reportStatus("user_reported_cancelled")
                showNotice("Recorded as not sent. No delivery is claimed.")
            }
            .setOnCancelListener {
                reportStatus("user_reported_cancelled")
                showNotice("No SMS-send confirmation was recorded.")
            }
            .show()
    }

    private fun reportStatus(status: String) {
        pendingSmsStatus = status
        executor.execute {
            val id = incidentId ?: return@execute
            if (lastStatusWritten == status) return@execute
            val stored = runCatching {
                apiRequest(
                    "/api/safety/incidents/$id/android-sms-status",
                    "POST",
                    JSONObject().put("status", status),
                )
            }.isSuccess
            if (stored) lastStatusWritten = status
        }
    }

    private fun loadContacts() {
        val base = normalizedBaseUrl()
        if (base == null) {
            showNotice("Set a valid backend address first.")
            return
        }
        preferences.edit().putString("base_url", base).apply()
        showHome("Loading trusted emergency contacts…")
        executor.execute {
            try {
                val array = JSONArray(apiRequest("/api/safety/contacts", "GET", null))
                val loaded = (0 until array.length()).mapNotNull { index ->
                    val item = array.optJSONObject(index) ?: return@mapNotNull null
                    EmergencyContact(
                        id = item.optInt("id"),
                        name = item.optString("name", "Contact"),
                        relationship = item.optString("relationship", ""),
                        phone = item.optString("phone", ""),
                        enabled = item.optBoolean("trusted", item.optBoolean("enabled", false)),
                        phoneVerified = item.optString("phoneVerifiedAt").isNotBlank() &&
                            item.optString("phoneVerifiedAt") != "null",
                    )
                }
                runOnUiThread {
                    contacts = loaded
                    if (selectedContactId == null || loaded.none {
                            it.enabled && it.id == selectedContactId
                        }
                    ) {
                        selectedContactId = loaded.firstOrNull { it.enabled }?.id
                    }
                    showContacts()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    showHome("Could not load contacts: ${error.message ?: "check sign-in and network"}")
                }
            }
        }
    }

    private fun openSignIn() {
        val base = normalizedBaseUrl()
        if (base == null) {
            showNotice("Set a valid backend address first.")
            return
        }
        preferences.edit().putString("base_url", base).apply()
        val webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("Sign in to AI Guardian")
            .setView(webView)
            .setNegativeButton("Close", null)
            .create()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                val cookie = CookieManager.getInstance().getCookie(base).orEmpty()
                if (cookie.split(";").any { it.trim().startsWith("app_session_id=") }) {
                    CookieManager.getInstance().flush()
                    dialog.dismiss()
                    loadContacts()
                }
            }
        }
        dialog.setOnDismissListener { webView.destroy() }
        dialog.show()
        webView.loadUrl(base)
    }

    private fun apiRequest(path: String, method: String, body: JSONObject?): String {
        val base = preferences.getString("base_url", null)
            ?: throw IllegalStateException("Backend address is not configured")
        val cookie = CookieManager.getInstance().getCookie(base)
            ?.split(";")
            ?.firstOrNull { it.trim().startsWith("app_session_id=") }
            ?.trim()
            ?: throw IllegalStateException("Not signed in. Sign in to AI Guardian first.")
        val connection = (URL("$base$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = NETWORK_TIMEOUT_MS
            readTimeout = NETWORK_TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cookie", cookie)
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val content = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val error = runCatching { JSONObject(content).optString("error") }.getOrDefault("")
                throw IllegalStateException(error.ifBlank { "Backend request failed ($code)" })
            }
            return content
        } finally {
            connection.disconnect()
        }
    }

    private fun normalizedBaseUrl(): String? {
        val value = if (::baseUrlField.isInitialized) baseUrlField.text.toString().trim() else
            preferences.getString("base_url", "").orEmpty().trim()
        if (value.isBlank() || value.contains('@')) return null
        val parsed = runCatching { Uri.parse(value) }.getOrNull() ?: return null
        if (parsed.scheme !in setOf("https", "http") || parsed.host.isNullOrBlank()) return null
        if (parsed.query != null || parsed.fragment != null) return null
        if (!BuildConfig.DEBUG && parsed.scheme != "https") return null
        return value.trimEnd('/')
    }

    private fun deviceId(): String = preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
        preferences.edit().putString("device_id", it).apply()
    }

    private fun selectedContactSummary(): String =
        contacts.firstOrNull { it.id == selectedContactId }?.let {
            "Selected contact: ${it.name} (${it.phone})"
        } ?:         "No contact selected. Choose a contact you trust for SOS first."

    private fun showNotice(message: String) {
        lastNotice = message
        AlertDialog.Builder(this)
            .setTitle("AI Guardian")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun newPage(): LinearLayout {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
            setBackgroundColor(0xFFF3F6F5.toInt())
        }
        val scroll = ScrollView(this).apply {
            addView(root)
        }
        setContentView(scroll)
        return root
    }

    private fun title(value: String) = TextView(this).apply {
        text = value
        textSize = 26f
        setTextColor(0xFF10252B.toInt())
        setPadding(0, dp(8), 0, dp(12))
    }

    private fun text(value: String) = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(0xFF34484D.toInt())
        setPadding(0, dp(6), 0, dp(12))
    }

    private fun label(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTextColor(0xFF34484D.toInt())
        setPadding(0, dp(16), 0, dp(4))
    }

    private fun button(value: String, action: () -> Unit) = Button(this).apply {
        text = value
        isAllCaps = false
        gravity = Gravity.CENTER
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(8) }
    }

    private fun fullWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val LOCATION_PERMISSION_REQUEST = 1001
        private const val SMS_COMPOSER_REQUEST = 1002
        private const val LOCATION_TIMEOUT_MS = 15_000L
        private const val STALE_LOCATION_MS = 5 * 60_000L
        private const val NETWORK_TIMEOUT_MS = 12_000
    }
}
