package com.mindguard;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class UsageStatsModule extends ReactContextBaseJavaModule {
    public UsageStatsModule(ReactApplicationContext context) {
        super(context);
    }

    /** Display name + whether Play Store / system marks the app as a game (for entertainment signal). */
    private void putAppMeta(PackageManager pm, WritableMap app, String packageName) {
        try {
            ApplicationInfo ai = pm.getApplicationInfo(packageName, PackageManager.GET_META_DATA);
            CharSequence label = pm.getApplicationLabel(ai);
            app.putString("appLabel", label != null ? label.toString() : packageName);
            boolean isGame = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (ai.category == ApplicationInfo.CATEGORY_GAME) {
                    isGame = true;
                }
                if ((ai.flags & ApplicationInfo.FLAG_IS_GAME) != 0) {
                    isGame = true;
                }
            }
            app.putBoolean("isGame", isGame);
        } catch (PackageManager.NameNotFoundException e) {
            app.putString("appLabel", packageName);
            app.putBoolean("isGame", false);
        }
    }

    /**
     * Counts session-style opens from UsageEvents: foreground entry after the app was in the
     * background (not reflection on UsageStats.mLaunchCount, which over-counts activity churn).
     */
    private Map<String, Integer> countRealLaunches(UsageStatsManager usm, long startMs, long endMs) {
        Map<String, Integer> launches = new HashMap<>();
        UsageEvents events = usm.queryEvents(startMs, endMs);
        if (events == null) {
            return launches;
        }

        UsageEvents.Event event = new UsageEvents.Event();
        Map<String, Integer> lastEventType = new HashMap<>();

        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            String pkg = event.getPackageName();
            int type = event.getEventType();

            if (isLaunchEntryEvent(type)) {
                Integer last = lastEventType.get(pkg);
                if (last == null || isBackgroundOrStoppedState(last)) {
                    launches.put(pkg, launches.getOrDefault(pkg, 0) + 1);
                }
            }
            lastEventType.put(pkg, type);
        }
        return launches;
    }

    private boolean isLaunchEntryEvent(int type) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return type == UsageEvents.Event.ACTIVITY_RESUMED
                || type == UsageEvents.Event.MOVE_TO_FOREGROUND;
        }
        return type == UsageEvents.Event.ACTIVITY_RESUMED;
    }

    private boolean isBackgroundOrStoppedState(int last) {
        if (last == UsageEvents.Event.ACTIVITY_PAUSED) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (last == UsageEvents.Event.ACTIVITY_STOPPED || last == UsageEvents.Event.MOVE_TO_BACKGROUND) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String getName() {
        return "UsageStatsModule";
    }

    /** Milliseconds since epoch when this package was first installed (changes on reinstall). */
    @ReactMethod
    public void getFirstInstallTime(Promise promise) {
        try {
            String pkg = getReactApplicationContext().getPackageName();
            long t = getReactApplicationContext()
                .getPackageManager()
                .getPackageInfo(pkg, 0)
                .firstInstallTime;
            promise.resolve((double) t);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Foreground time is summed from UsageEvents so the window [start, end] is respected
     * (queryUsageStats + INTERVAL_BEST can still over-count on some OEMs).
     */
    @ReactMethod
    public void getUsageStats(double startTime, double endTime, Promise promise) {
        try {
            long startMs = (long) startTime;
            long endMs = (long) endTime;
            if (endMs <= startMs) {
                promise.resolve(Arguments.createArray());
                return;
            }

            UsageStatsManager usageStatsManager = (UsageStatsManager)
                getReactApplicationContext().getSystemService(Context.USAGE_STATS_SERVICE);
            PackageManager pm = getReactApplicationContext().getPackageManager();

            Map<String, Long> fgMs = aggregateForegroundFromEvents(usageStatsManager, startMs, endMs);

            Map<String, Integer> launches = countRealLaunches(usageStatsManager, startMs, endMs);
            List<UsageStats> bucketStats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_BEST,
                startMs,
                endMs
            );

            WritableArray result = Arguments.createArray();

            if (fgMs.isEmpty() && bucketStats != null) {
                for (UsageStats s : bucketStats) {
                    if (s.getTotalTimeInForeground() <= 0) continue;
                    WritableMap app = Arguments.createMap();
                    String pkg = s.getPackageName();
                    app.putString("packageName", pkg);
                    app.putDouble("totalTimeInForeground", (double) s.getTotalTimeInForeground());
                    app.putInt("launchCount", launches.getOrDefault(pkg, 0));
                    putAppMeta(pm, app, pkg);
                    result.pushMap(app);
                }
            } else {
                for (Map.Entry<String, Long> e : fgMs.entrySet()) {
                    WritableMap app = Arguments.createMap();
                    String pkg = e.getKey();
                    app.putString("packageName", pkg);
                    app.putDouble("totalTimeInForeground", (double) e.getValue());
                    app.putInt("launchCount", launches.getOrDefault(pkg, 0));
                    putAppMeta(pm, app, pkg);
                    result.pushMap(app);
                }
            }
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    private Map<String, Long> aggregateForegroundFromEvents(UsageStatsManager usm, long startMs, long endMs) {
        Map<String, Long> totals = new HashMap<>();
        UsageEvents events = usm.queryEvents(startMs, endMs);
        if (events == null) {
            return totals;
        }

        UsageEvents.Event event = new UsageEvents.Event();
        Map<String, Long> lastResume = new HashMap<>();

        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            String pkg = event.getPackageName();
            long ts = event.getTimeStamp();
            int t = event.getEventType();

            if (isForegroundStart(t)) {
                lastResume.put(pkg, ts);
            } else if (isForegroundEnd(t)) {
                Long s = lastResume.remove(pkg);
                if (s != null) {
                    long add = Math.max(0L, Math.min(ts, endMs) - Math.max(s, startMs));
                    if (add > 0) {
                        totals.put(pkg, totals.getOrDefault(pkg, 0L) + add);
                    }
                }
            }
        }

        for (Map.Entry<String, Long> e : lastResume.entrySet()) {
            String pkg = e.getKey();
            long s = Math.max(e.getValue(), startMs);
            long add = Math.max(0L, endMs - s);
            if (add > 0) {
                totals.put(pkg, totals.getOrDefault(pkg, 0L) + add);
            }
        }
        return totals;
    }

    private boolean isForegroundStart(int t) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return t == UsageEvents.Event.ACTIVITY_RESUMED
                || t == UsageEvents.Event.MOVE_TO_FOREGROUND;
        }
        return t == UsageEvents.Event.ACTIVITY_RESUMED;
    }

    private boolean isForegroundEnd(int t) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return t == UsageEvents.Event.ACTIVITY_PAUSED
                || t == UsageEvents.Event.MOVE_TO_BACKGROUND;
        }
        return t == UsageEvents.Event.ACTIVITY_PAUSED;
    }

    /**
     * True if the user has granted "Usage access" (GET_USAGE_STATS) for this app.
     * Do not infer permission from queryUsageStats — a short time window can be empty even when
     * permission is granted, which broke "Done" until a cold restart.
     */
    private static boolean hasUsageStatsPermission(Context context) {
        try {
            AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) {
                return false;
            }
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.getPackageName()
                );
            } else {
                mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    context.getPackageName()
                );
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    @ReactMethod
    public void checkPermission(Promise promise) {
        try {
            promise.resolve(hasUsageStatsPermission(getReactApplicationContext()));
        } catch (Exception e) {
            promise.resolve(false);
        }
    }
}
