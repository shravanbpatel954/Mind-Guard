package com.mindguard;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

public class FilePickerModule extends ReactContextBaseJavaModule {
    private static final int PICK_FILE_REQUEST = 10101;
    private Promise mPickerPromise;

    private final ActivityEventListener mActivityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent intent) {
            if (requestCode == PICK_FILE_REQUEST) {
                if (mPickerPromise != null) {
                    if (resultCode == Activity.RESULT_CANCELED) {
                        mPickerPromise.reject("PICK_CANCELLED", "File picking was cancelled");
                    } else if (resultCode == Activity.RESULT_OK && intent != null) {
                        try {
                            Uri uri = intent.getData();
                            if (uri != null) {
                                WritableMap map = Arguments.createMap();
                                map.putString("uri", uri.toString());
                                
                                String displayName = "document.pdf";
                                Cursor cursor = getReactApplicationContext().getContentResolver()
                                        .query(uri, null, null, null, null, null);
                                if (cursor != null && cursor.moveToFirst()) {
                                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                                    if (nameIndex != -1) {
                                        displayName = cursor.getString(nameIndex);
                                    }
                                    cursor.close();
                                }
                                map.putString("name", displayName);
                                mPickerPromise.resolve(map);
                            } else {
                                mPickerPromise.reject("PICK_FAILED", "File URI is null");
                            }
                        } catch(Exception e) {
                             mPickerPromise.reject("PICK_ERROR", e.getMessage());
                        }
                    }
                    mPickerPromise = null;
                }
            }
        }
    };

    FilePickerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addActivityEventListener(mActivityEventListener);
    }

    @Override
    public String getName() {
        return "CustomFilePicker";
    }

    @ReactMethod
    public void pickPdf(Promise promise) {
        Activity currentActivity = getCurrentActivity();

        if (currentActivity == null) {
            promise.reject("ACTIVITY_DOES_NOT_EXIST", "Activity doesn't exist");
            return;
        }

        mPickerPromise = promise;

        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("application/pdf");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            currentActivity.startActivityForResult(intent, PICK_FILE_REQUEST);
        } catch (Exception e) {
            mPickerPromise.reject("PICK_ERROR", e.getMessage());
            mPickerPromise = null;
        }
    }
}
