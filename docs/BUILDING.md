# Building UNO by J

## Toolchain (this machine)

| Component | Location | Version |
|---|---|---|
| JDK | `~/uno-tools/jdk-21.0.12.1+1` | Temurin 21 (Gradle/AGP compatible; system JDK 25 is not used) |
| Gradle | `~/uno-tools/gradle-8.11.1` | 8.11.1 (wrapper properties point here when local) |
| Android SDK | `~/uno-tools/android-sdk` | platform 34, build-tools 34.0.0, platform-tools 34.0.5 |
| cmdline-tools | `~/uno-tools/android-sdk/cmdline-tools/latest` | 12.0 |

All components live in `~/uno-tools` (outside the repo) and were installed from official
distribution zips with SHA-1 verification against Google's repository manifest.

## Command-line build (Git Bash)

```bash
export JAVA_HOME="$HOME/uno-tools/jdk-21.0.12.1+1"
export ANDROID_HOME="$HOME/uno-tools/android-sdk"

cd android
~/uno-tools/gradle-8.11.1/bin/gradle --no-daemon :app:assembleDebug   # build APK
~/uno-tools/gradle-8.11.1/bin/gradle --no-daemon :app:testDebugUnitTest  # unit tests
```

Output APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Android Studio

Open the `android/` folder as a Gradle project. `android/local.properties` is
machine-local (git-ignored) and points at the SDK above.

## Notes

- `targetSdk` is temporarily pinned to 34; bumping to 35 (Play requirement) is part of
  Phase 12 release prep, not scaffold work.
- Release builds are unsigned until keystore setup in Phase 12.
- The Gradle wrapper JAR is not committed in this scaffold; use the local Gradle above or
  run `gradle wrapper` once with the local distribution to generate it.
