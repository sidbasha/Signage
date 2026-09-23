package com.signagecms.player;

import android.content.Context;
import android.content.SharedPreferences;

final class Prefs {
    private Prefs() {}
    private static SharedPreferences p(Context c) { return c.getSharedPreferences("signage", Context.MODE_PRIVATE); }
    static String serverUrl(Context c) { return p(c).getString("server", null); }
    static void setServerUrl(Context c, String url) { p(c).edit().putString("server", url).apply(); }
    static boolean autoStart(Context c) { return p(c).getBoolean("autostart", true); }
    static void setAutoStart(Context c, boolean on) { p(c).edit().putBoolean("autostart", on).apply(); }

    /** Accepts "192.168.1.10:5080", "http://host", "https://host/"; returns a clean origin or null. */
    static String normalize(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        if (s.endsWith("/player")) s = s.substring(0, s.length() - 7);
        try { android.net.Uri u = android.net.Uri.parse(s); return u.getHost() == null || u.getHost().isEmpty() ? null : s; }
        catch (Exception e) { return null; }
    }
}
