import { memo, useCallback, useEffect, useRef } from "react";
import type { PreviewResult } from "./api";
import { IconField } from "./components/ui/icons";

interface Props {
  preview: PreviewResult | null;
  running: boolean;
  /** 0..1; eased in canvas, never by re-rendering React on every frame. */
  progress: number;
  finished?: boolean;
  failed?: boolean;
  className?: string;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface Colors {
  accent: string;
  danger: string;
  bg: string;
  line: string;
  text: string;
}

function boundsOf(rings: [number, number][][]): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const ring of rings) {
    for (const [lat, lon] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function readColors(): Colors {
  return {
    accent: cssVar("--accent", "#087cfa"),
    danger: cssVar("--danger", "#d94a4a"),
    bg: cssVar("--track-bg", "#f1f3f6"),
    line: cssVar("--track-line", "rgba(18,24,38,0.2)"),
    text: cssVar("--text-3", "#9aa0ab"),
  };
}

function TrackCanvas({
  preview,
  running,
  progress,
  finished = false,
  failed = false,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const baseKeyRef = useRef<{ preview: PreviewResult; w: number; h: number; colors: Colors } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const colorsRef = useRef<Colors | null>(null);
  const displayRef = useRef(progress);
  const targetRef = useRef(progress);
  const rafRef = useRef(0);
  const reducedRef = useRef(false);
  const lastTsRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // Self-heal the canvas size if the first preview arrives before layout.
    // Without this, a fast initial IPC response can leave the canvas blank
    // until the next resize event.
    if (sizeRef.current.w === 0 || sizeRef.current.h === 0) {
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = rect.width;
      const h = rect.height;
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const initial = canvas.getContext("2d");
      if (initial) initial.setTransform(dpr, 0, 0, dpr, 0, 0);
      colorsRef.current = readColors();
    }

    const { w, h } = sizeRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!colorsRef.current) colorsRef.current = readColors();
    const c = colorsRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const p = preview;
    if (!p || !p.ok || p.points.length < 2) {
      if (baseRef.current && baseKeyRef.current) {
        const base = baseRef.current;
        base.getContext("2d")?.clearRect(0, 0, base.width, base.height);
        baseKeyRef.current = null;
      }
      return;
    }

    const b = boundsOf([p.fence, p.points]);
    if (!b) return;

    const pad = Math.max(26, Math.min(w, h) * 0.14);
    const cos = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
    const spanLon = Math.max(1e-7, (b.maxLon - b.minLon) * cos);
    const spanLat = Math.max(1e-7, b.maxLat - b.minLat);
    const scale = Math.min((w - pad * 2) / spanLon, (h - pad * 2) / spanLat);
    const project = (lat: number, lon: number): [number, number] => [
      w / 2 + (lon - (b.minLon + b.maxLon) / 2) * cos * scale,
      h / 2 - (lat - (b.minLat + b.maxLat) / 2) * scale,
    ];

    // The fence and route preview only change with geometry, size or theme.
    // Keep them on a separate layer while progress is interpolated above it.
    const base = baseRef.current;
    const key = baseKeyRef.current;
    if (base && (!key || key.preview !== p || key.w !== w || key.h !== h || key.colors !== c)) {
      base.width = canvas.width;
      base.height = canvas.height;
      const bg = base.getContext("2d");
      if (bg) {
        const dpr = canvas.width / w;
        bg.setTransform(dpr, 0, 0, dpr, 0, 0);
        bg.lineJoin = "round";
        bg.lineCap = "round";
        if (p.fence.length >= 3) {
          bg.beginPath();
          p.fence.forEach(([lat, lon], i) => {
            const [x, y] = project(lat, lon);
            if (i === 0) bg.moveTo(x, y); else bg.lineTo(x, y);
          });
          bg.closePath();
          bg.strokeStyle = c.line;
          bg.lineWidth = 0.8;
          bg.setLineDash([3, 5]);
          bg.stroke();
          bg.setLineDash([]);
        }
        // Backend-supplied lane estimates are visual reference only.
        for (const lane of p.trackLanes ?? []) {
          if (lane.length < 2) continue;
          bg.beginPath();
          lane.forEach(([lat, lon], i) => {
            const [x, y] = project(lat, lon);
            if (i === 0) bg.moveTo(x, y); else bg.lineTo(x, y);
          });
          bg.closePath();
          bg.strokeStyle = c.line;
          bg.globalAlpha = 0.35;
          bg.lineWidth = 0.7;
          bg.stroke();
        }
        bg.globalAlpha = 1;
        const trace = (end: number) => {
          bg.beginPath();
          for (let i = 0; i < end; i++) {
            const [x, y] = project(p.points[i][0], p.points[i][1]);
            if (i === 0) bg.moveTo(x, y); else bg.lineTo(x, y);
          }
        };
        // One real lap provides a quiet neutral reference; all original points
        // remain visible as a faint preview and are used unchanged for progress.
        const [sx, sy] = project(p.points[0][0], p.points[0][1]);
        let lapEnd = p.points.length;
        let departed = false;
        const routeSize = Math.hypot(spanLon * scale, spanLat * scale);
        for (let i = 1; i < p.points.length; i++) {
          const [x, y] = project(p.points[i][0], p.points[i][1]);
          const distance = Math.hypot(x - sx, y - sy);
          if (distance > routeSize * 0.3) departed = true;
          if (departed && distance < routeSize * 0.08) { lapEnd = i + 1; break; }
        }
        trace(lapEnd);
        bg.strokeStyle = c.text;
        bg.globalAlpha = 0.6;
        bg.lineWidth = 1.8;
        bg.stroke();
        trace(p.points.length);
        bg.globalAlpha = 0.12;
        bg.lineWidth = 0.7;
        bg.stroke();
        bg.globalAlpha = 1;
      }
      baseKeyRef.current = { preview: p, w, h, colors: c };
    }

    // ---------------------------------------------------------- progress route
    const frac = Math.max(0, Math.min(1, displayRef.current));
    const lastF = frac * (p.points.length - 1);
    const lastI = Math.floor(lastF);
    const progressColor = failed ? c.danger : c.accent;

    if (lastI >= 1) {
      ctx.beginPath();
      for (let i = 0; i <= lastI; i++) {
        const [x, y] = project(p.points[i][0], p.points[i][1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (lastI < p.points.length - 1) {
        const t = lastF - lastI;
        const [ax, ay] = project(p.points[lastI][0], p.points[lastI][1]);
        const [bx, by] = project(
          p.points[lastI + 1][0],
          p.points[lastI + 1][1]
        );
        ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t);
      }

      ctx.strokeStyle = progressColor;
      ctx.lineWidth = 2.25;
      ctx.stroke();
    }

    // A single marker follows the same interpolated segment as the line.
    const idx = Math.min(Math.max(lastI, 0), p.points.length - 1);
    const [ax, ay] = project(p.points[idx][0], p.points[idx][1]);
    const [bx, by] = idx + 1 < p.points.length
      ? project(p.points[idx + 1][0], p.points[idx + 1][1]) : [ax, ay];
    const t = lastF - idx;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;

    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = c.bg;
    ctx.fill();
    ctx.strokeStyle = progressColor;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 2.3, 0, Math.PI * 2);
    ctx.fillStyle = progressColor;
    ctx.fill();
  }, [preview, finished, failed]);

  const startLoop = useCallback(() => {
    if (rafRef.current) return;
    const tick = (ts: number) => {
      const target = targetRef.current;
      const current = displayRef.current;
      const diff = target - current;
      if (Math.abs(diff) < 0.00035) {
        displayRef.current = target;
        draw();
        lastTsRef.current = ts;
        rafRef.current = 0;
        return;
      }
      const dt = lastTsRef.current ? Math.min(48, ts - lastTsRef.current) : 16;
      const factor = 1 - Math.pow(0.88, dt / 16);
      displayRef.current = current + diff * factor;
      lastTsRef.current = ts;
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [draw]);

  // watch the theme attribute so a theme switch repaints the canvas
  useEffect(() => {
    const mo = new MutationObserver(() => {
      colorsRef.current = readColors();
      draw();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-prefers-color-scheme"],
    });
    return () => mo.disconnect();
  }, [draw]);

  // reduced motion: no interpolation, no pulse loop
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
      if (mq.matches) {
        displayRef.current = targetRef.current;
        draw();
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [draw, startLoop]);

  // size management
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = rect.width;
      const h = rect.height;
      sizeRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colorsRef.current = readColors();
      draw();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    targetRef.current = progress;
    if (reducedRef.current) {
      displayRef.current = progress;
      draw();
      return;
    }
    startLoop();
  }, [progress, startLoop, draw]);

  useEffect(() => {
    if (reducedRef.current) {
      draw();
      return;
    }
    startLoop();
  }, [running, startLoop, draw]);

  useEffect(() => {
    draw();
    // A second paint after layout settles covers the "preview beat layout"
    // race without introducing a React render on every frame.
    const t = window.setTimeout(() => draw(), 180);
    return () => window.clearTimeout(t);
  }, [preview, finished, failed, draw]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  const empty = !preview || !preview.ok || preview.points.length < 2;

  return (
    <div
      ref={wrapRef}
      className={["track-canvas", className ?? ""].filter(Boolean).join(" ")}
    >
      <canvas ref={baseRef} className="track-base" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          empty
            ? "轨迹预览：暂无数据"
            : `轨迹预览，${preview.count} 个采样点，已完成 ${Math.round(
                progress * 100
              )}%`
        }
      />
      {empty && (
        <div className="track-empty">
          <span className="track-empty-icon">
            <IconField size={24} />
          </span>
          <span className="track-empty-title">
            {preview?.message || "同步场地后生成真实轨迹"}
          </span>
          <span className="track-empty-sub">
            轨迹只在本机按围栏与配速计算
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(TrackCanvas);
