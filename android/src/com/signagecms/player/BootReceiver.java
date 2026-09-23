package com.signagecms.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Starts the player when the device boots, so a screen recovers from power cuts without anyone touching it. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Prefs.autoStart(context) || Prefs.serverUrl(context) == null) return;
        Intent start = new Intent(context, MainActivity.class);
        start.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { context.startActivity(start); } catch (Exception ignored) { /* blocked on Android 10+ without overlay permission */ }
    }
}
