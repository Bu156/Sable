package moe.sable.unifiedpush

import android.content.Context
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.MessagingReceiver
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

class UnifiedPushReceiver : MessagingReceiver() {
    override fun onNewEndpoint(context: Context, endpoint: PushEndpoint, instance: String) {
        UnifiedPushPlugin.instance?.onNewEndpoint(endpoint.url)
    }

    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        UnifiedPushPlugin.instance?.onRegistrationFailed(reason.name)
    }

    override fun onUnregistered(context: Context, instance: String) {
        UnifiedPushPlugin.instance?.onUnregistered()
    }

    override fun onMessage(context: Context, message: PushMessage, instance: String) {
        UnifiedPushPlugin.instance?.onMessage(String(message.content), null)
    }
}
