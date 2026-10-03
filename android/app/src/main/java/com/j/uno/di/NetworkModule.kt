package com.j.uno.di

import android.content.Context
import com.j.uno.net.EncryptedSessionStore
import com.j.uno.net.SessionStore
import com.j.uno.net.UnoApiService
import com.j.uno.net.UnoWebSocketClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    @Named("BaseHttpUrl")
    fun provideBaseHttpUrl(): String = "https://uno-by-j-api.uno-by-j.workers.dev"

    @Provides
    @Singleton
    @Named("BaseWsUrl")
    fun provideBaseWsUrl(): String = "wss://uno-by-j-api.uno-by-j.workers.dev"

    @Provides
    @Singleton
    fun provideOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun provideSessionStore(
        @ApplicationContext context: Context
    ): SessionStore = EncryptedSessionStore(context)

    @Provides
    @Singleton
    fun provideUnoApiService(
        @Named("BaseHttpUrl") baseUrl: String,
        client: OkHttpClient
    ): UnoApiService = UnoApiService(baseUrl = baseUrl, client = client)

    @Provides
    @Singleton
    fun provideUnoWebSocketClient(
        @Named("BaseWsUrl") wsBaseUrl: String,
        client: OkHttpClient
    ): UnoWebSocketClient = UnoWebSocketClient(wsBaseUrl = wsBaseUrl, client = client)
}
