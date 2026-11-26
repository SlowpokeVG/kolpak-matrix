# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep Android bridge symbols used by Wry/Tauri JNI on release builds.
# Without these, R8 can rename/remove methods like WryActivity.getId(),
# which tao resolves by method name via JNI.
-keep class com.klpq.kolpak.* {
  native <methods>;
}

-keep class com.klpq.kolpak.WryActivity {
  public <init>(...);

  void setWebView(com.klpq.kolpak.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
  int startActivity(...);
  int getId();
}

-keep class com.klpq.kolpak.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.klpq.kolpak.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.klpq.kolpak.RustWebChromeClient,com.klpq.kolpak.RustWebViewClient {
  public <init>(...);
}
# Static methods that Rust calls through JNI (src-tauri/src/mobile.rs): nothing in Kotlin
# calls them, so R8 would otherwise remove or rename them in release builds.
-keepclassmembers class com.klpq.kolpak.MainActivity {
  public static *** *Native(...);
}
