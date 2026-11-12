/*
 * Application 入口：
 *   1. 在任何 Activity 之前把主题定下来（否则会白闪一下再变黑）
 *   2. 抓未捕获异常，把堆栈落到 filesDir/last_crash.txt
 *      —— 没接电脑、没 adb 也能知道为什么崩，下次启动会把内容弹出来
 *
 * 作者：小雨
 */
package com.xiaoyu.run

import android.app.Application
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class App : Application() {

    override fun onCreate() {
        super.onCreate()
        installCrashCatcher()
        AppCompatDelegate.setDefaultNightMode(
            getSharedPreferences("xiaoyurun", MODE_PRIVATE)
                .getInt("themeMode", AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM)
        )
    }

    /**
     * 把崩溃堆栈既写 Logcat 也写本地文件。
     * 不吞异常 —— 写完照旧交给系统处理器，系统该弹「应用已停止运行」还是弹。
     */
    private fun installCrashCatcher() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val sw = StringWriter()
                PrintWriter(sw).use { error.printStackTrace(it) }
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA)
                    .format(Date())
                val report = buildString {
                    appendLine("小雨run 崩溃报告")
                    appendLine("时间: $stamp")
                    appendLine("线程: ${thread.name}")
                    appendLine("版本: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    appendLine("机型: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                    appendLine("系统: Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
                    appendLine("---------------- 堆栈 ----------------")
                    append(sw.toString())
                }
                File(filesDir, "last_crash.txt").writeText(report)
                Log.e("XiaoYuRun", report)
            } catch (_: Throwable) {
                // 崩溃处理里再崩就放弃，别套娃
            }
            previous?.uncaughtException(thread, error)
        }
    }
}
