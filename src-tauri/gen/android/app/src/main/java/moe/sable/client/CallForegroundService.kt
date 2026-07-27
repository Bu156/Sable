package moe.sable.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class CallForegroundService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(true)
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Calls",
      NotificationManager.IMPORTANCE_LOW
    )
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_notification)
      .setContentTitle("Call in progress")
      .setContentText("Sable is keeping your call active")
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "call_foreground"
    private const val NOTIFICATION_ID = 1395
  }
}
