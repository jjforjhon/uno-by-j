# Keep Hilt-generated classes
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }

# Keep Kotlinx Serialization models and serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.SerializationKt

-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
    @kotlinx.serialization.Serializable <fields>;
}

-keepclassmembers class * {
    *** Companion;
}

-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}

-keepclassmembers class * extends kotlinx.serialization.KSerializer {
    <fields>;
    <methods>;
}

# Keep all domain protocol and DTO models
-keep class com.j.uno.model.** { *; }

# Security-crypto / Tink compile-time annotations
-dontwarn com.google.errorprone.annotations.**
