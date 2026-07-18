package moe.sable.unifiedpush

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID
import java.util.concurrent.TimeUnit

@InvokeArg
class DistributorArgs {
    lateinit var name: String
}

@InvokeArg
class TokenArgs {
    lateinit var token: String
}

@TauriPlugin
class UnifiedPushPlugin(private val activity: Activity): Plugin(activity) {

    companion object {
        private const val PREFS_NAME = "unifiedpush_prefs"
        private const val KEY_DISTRIBUTOR = "selected_distributor"
        private const val KEY_TOKEN = "token"
        private const val APP_NAME = "moe.sable.client"

        const val ACTION_DISTRIBUTOR_REGISTER = "org.unifiedpush.android.distributor.REGISTER"
        const val ACTION_DISTRIBUTOR_UNREGISTER = "org.unifiedpush.android.distributor.UNREGISTER"

        const val ACTION_CONNECTOR_NEW_ENDPOINT = "org.unifiedpush.android.connector.NEW_ENDPOINT"
        const val ACTION_CONNECTOR_UNREGISTERED = "org.unifiedpush.android.connector.UNREGISTERED"
        const val ACTION_CONNECTOR_MESSAGE = "org.unifiedpush.android.connector.MESSAGE"
        const val ACTION_CONNECTOR_NEW_ENDPOINT_DENIED = "org.unifiedpush.android.connector.NEW_ENDPOINT_DENIED"

        var instance: UnifiedPushPlugin? = null
    }

    private var prefs: SharedPreferences =
        activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private var pendingRegistration: Invoke? = null
    private var registrationTimeout: Runnable? = null

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        instance = this
    }

    @Command
    fun listDistributors(invoke: Invoke) {
        val intent = Intent(ACTION_DISTRIBUTOR_REGISTER)
        val receivers = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.queryBroadcastReceivers(
                intent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_ALL.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.queryBroadcastReceivers(intent, PackageManager.MATCH_ALL)
        }

        val distributors = JSArray()
        val seen = mutableSetOf<String>()
        for (receiver in receivers) {
            val packageName = receiver.activityInfo.packageName
            if (seen.add(packageName)) {
                distributors.put(packageName)
            }
        }

        val result = JSObject()
        result.put("distributors", distributors)
        invoke.resolve(result)
    }

    @Command
    fun setDistributor(invoke: Invoke) {
        val args = invoke.parseArgs(DistributorArgs::class.java)
        prefs.edit().putString(KEY_DISTRIBUTOR, args.name).apply()
        invoke.resolve()
    }

    @Command
    fun registerForPushNotifications(invoke: Invoke) {
        val distributor = prefs.getString(KEY_DISTRIBUTOR, null)
        if (distributor.isNullOrEmpty()) {
            invoke.reject("No UnifiedPush distributor selected")
            return
        }

        val token = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_TOKEN, token).apply()
        pendingRegistration = invoke

        val intent = Intent(ACTION_DISTRIBUTOR_REGISTER)
            .setPackage(distributor)
            .putExtra("application", APP_NAME)
            .putExtra("token", token)
        activity.sendBroadcast(intent)

        val timeoutMs = TimeUnit.SECONDS.toMillis(30)
        registrationTimeout = Runnable {
            pendingRegistration?.reject("UnifiedPush registration timed out")
            pendingRegistration = null
        }
        registrationTimeout?.let { runnable ->
            android.os.Handler(activity.mainLooper).postDelayed(runnable, timeoutMs)
        }
    }

    @Command
    fun unregisterForPushNotifications(invoke: Invoke) {
        val token = prefs.getString(KEY_TOKEN, null)
        val distributor = prefs.getString(KEY_DISTRIBUTOR, null)

        if (!distributor.isNullOrEmpty()) {
            val intent = Intent(ACTION_DISTRIBUTOR_UNREGISTER)
                .setPackage(distributor)
                .putExtra("application", APP_NAME)
            if (token != null) {
                intent.putExtra("token", token)
            }
            activity.sendBroadcast(intent)
        }

        prefs.edit().remove(KEY_TOKEN).apply()
        invoke.resolve()
    }

    @Command
    fun setToken(invoke: Invoke) {
        val args = invoke.parseArgs(TokenArgs::class.java)
        prefs.edit().putString(KEY_TOKEN, args.token).apply()
        invoke.resolve()
    }

    fun onNewEndpoint(endpoint: String, token: String?) {
        val savedToken = prefs.getString(KEY_TOKEN, null)
        if (token != null && token != savedToken) return

        registrationTimeout?.let { runnable ->
            android.os.Handler(activity.mainLooper).removeCallbacks(runnable)
        }
        registrationTimeout = null

        val result = JSObject()
        result.put("deviceToken", endpoint)
        pendingRegistration?.resolve(result)
        pendingRegistration = null
    }

    fun onRegistrationDenied() {
        registrationTimeout?.let { runnable ->
            android.os.Handler(activity.mainLooper).removeCallbacks(runnable)
        }
        registrationTimeout = null

        pendingRegistration?.reject("UnifiedPush registration denied by distributor")
        pendingRegistration = null
    }

    fun onUnregistered() {
        registrationTimeout?.let { runnable ->
            android.os.Handler(activity.mainLooper).removeCallbacks(runnable)
        }
        registrationTimeout = null

        prefs.edit().remove(KEY_TOKEN).apply()
        pendingRegistration?.resolve(JSObject())
        pendingRegistration = null
    }

    fun onMessage(message: String, eventId: String?) {
        val data = JSObject()
        data.put("message", message)
        if (eventId != null) data.put("eventId", eventId)
        trigger("push-message", data)
    }
}
