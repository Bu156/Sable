package moe.sable.unifiedpush

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class UnifiedPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val plugin = UnifiedPushPlugin.instance ?: return

        when (intent.action) {
            UnifiedPushPlugin.ACTION_CONNECTOR_NEW_ENDPOINT -> {
                val endpoint = intent.getStringExtra("endpoint")
                val token = intent.getStringExtra("token")
                if (endpoint != null) {
                    plugin.onNewEndpoint(endpoint, token)
                }
            }
            UnifiedPushPlugin.ACTION_CONNECTOR_NEW_ENDPOINT_DENIED -> {
                plugin.onRegistrationDenied()
            }
            UnifiedPushPlugin.ACTION_CONNECTOR_UNREGISTERED -> {
                plugin.onUnregistered()
            }
            UnifiedPushPlugin.ACTION_CONNECTOR_MESSAGE -> {
                val message = intent.getStringExtra("message")
                val eventId = intent.getStringExtra("eventId")
                if (message != null) {
                    plugin.onMessage(message, eventId)
                }
            }
        }
    }
}
