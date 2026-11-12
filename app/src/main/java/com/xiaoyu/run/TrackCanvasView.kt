package com.xiaoyu.run

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import androidx.core.content.ContextCompat
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * 小雨run · 拟真动态跑道视图 (Apple Fitness 风格)
 * 渲染操场环形跑道、电子围栏轮廓与实时跑动动态指示点。
 */
class TrackCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3.5f * resources.displayMetrics.density
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val lanePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 1f * resources.displayMetrics.density
        pathEffect = DashPathEffect(floatArrayOf(12f, 12f), 0f)
    }

    private val runnerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    private val pulsePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }

    private var progress: Float = 0f
    private var isRunning: Boolean = false
    private var pulseRadius: Float = 0f
    private var pulseAlpha: Int = 0

    private val trackPath = Path()
    private val boundsRect = RectF()

    private var pulseAnimator: ValueAnimator? = null

    init {
        setupColors()
    }

    private fun setupColors() {
        val isDark = (resources.configuration.uiMode and
                android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES

        val accentColor = ContextCompat.getColor(context, R.color.accent)
        trackPaint.color = accentColor
        runnerPaint.color = accentColor
        pulsePaint.color = accentColor

        lanePaint.color = if (isDark) Color.parseColor("#33FFFFFF") else Color.parseColor("#1A000000")
    }

    fun setProgress(pct: Float) {
        progress = pct.coerceIn(0f, 1f)
        invalidate()
    }

    fun setRunning(running: Boolean) {
        if (isRunning == running) return
        isRunning = running
        if (running) {
            startPulse()
        } else {
            stopPulse()
        }
        invalidate()
    }

    private fun startPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1400
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener { anim ->
                val v = anim.animatedValue as Float
                val density = resources.displayMetrics.density
                pulseRadius = (8f + v * 16f) * density
                pulseAlpha = ((1f - v) * 110).toInt()
                invalidate()
            }
            start()
        }
    }

    private fun stopPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        pulseRadius = 0f
        pulseAlpha = 0
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val density = resources.displayMetrics.density
        val pad = 16f * density
        boundsRect.set(pad, pad, w - pad, h - pad)
        buildDefaultTrackPath()
    }

    private fun buildDefaultTrackPath() {
        trackPath.reset()
        val r = min(boundsRect.height() / 2f, boundsRect.width() / 4f)
        trackPath.addRoundRect(boundsRect, r, r, Path.Direction.CW)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        setupColors()

        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0 || h <= 0) return

        val density = resources.displayMetrics.density
        val r = min(boundsRect.height() / 2f, boundsRect.width() / 4f)
        if (r <= 0f || boundsRect.width() <= 0f || boundsRect.height() <= 0f) return

        // 1. 绘制跑道底线 (外道与内虚线)
        canvas.drawRoundRect(boundsRect, r, r, lanePaint)

        // 2. 绘制跑道主线
        canvas.drawRoundRect(boundsRect, r, r, trackPaint)

        // 3. 计算跑动位置 (沿圆角矩形周长巡航)
        val perimeter = 2 * (boundsRect.width() - 2 * r) + 2 * Math.PI.toFloat() * r
        val currDist = (progress * perimeter) % perimeter

        val pt = calculatePositionOnRoundedRect(boundsRect, r, currDist)

        // 4. 绘制跑步动态脉冲圈 (Running 状态)
        if (isRunning && pulseAlpha > 0) {
            pulsePaint.alpha = pulseAlpha
            canvas.drawCircle(pt[0], pt[1], pulseRadius, pulsePaint)
        }

        // 5. 绘制核心指示器外圈与实心点
        val runnerRadius = 6f * density
        runnerPaint.alpha = 255
        canvas.drawCircle(pt[0], pt[1], runnerRadius, runnerPaint)

        val innerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.WHITE
        }
        canvas.drawCircle(pt[0], pt[1], runnerRadius * 0.45f, innerPaint)
    }

    private fun calculatePositionOnRoundedRect(rect: RectF, r: Float, dist: Float): FloatArray {
        val straightW = rect.width() - 2 * r
        val arcLen = (Math.PI.toFloat() * r) / 2f

        var d = dist
        // 顶部平直段 (从左往右)
        if (d <= straightW) {
            return floatArrayOf(rect.left + r + d, rect.top)
        }
        d -= straightW

        // 右上圆弧 (0 ~ 90 deg)
        if (d <= arcLen) {
            val angle = (d / arcLen) * (Math.PI / 2.0) - Math.PI / 2.0
            val cx = rect.right - r
            val cy = rect.top + r
            return floatArrayOf((cx + r * cos(angle)).toFloat(), (cy + r * sin(angle)).toFloat())
        }
        d -= arcLen

        // 右下圆弧 (90 ~ 180 deg)
        if (d <= arcLen) {
            val angle = (d / arcLen) * (Math.PI / 2.0)
            val cx = rect.right - r
            val cy = rect.bottom - r
            return floatArrayOf((cx + r * cos(angle)).toFloat(), (cy + r * sin(angle)).toFloat())
        }
        d -= arcLen

        // 底部平直段 (从右往左)
        if (d <= straightW) {
            return floatArrayOf(rect.right - r - d, rect.bottom)
        }
        d -= straightW

        // 左下圆弧
        if (d <= arcLen) {
            val angle = (d / arcLen) * (Math.PI / 2.0) + Math.PI / 2.0
            val cx = rect.left + r
            val cy = rect.bottom - r
            return floatArrayOf((cx + r * cos(angle)).toFloat(), (cy + r * sin(angle)).toFloat())
        }
        d -= arcLen

        // 左上圆弧
        val angle = (d / arcLen) * (Math.PI / 2.0) + Math.PI
        val cx = rect.left + r
        val cy = rect.top + r
        return floatArrayOf((cx + r * cos(angle)).toFloat(), (cy + r * sin(angle)).toFloat())
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stopPulse()
    }
}
