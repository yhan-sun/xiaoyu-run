import { useEffect, useRef, useState } from "react";
import type { PreviewResult } from "./api";

interface Props {
  preview: PreviewResult | null;
  running: boolean;
  /** 0..1，进度；静止时也会插值过渡 */
  progress: number;
  height?: number;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
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

export default function TrackCanvas({ preview, running, progress, height = 210 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef(progress);
  const rafRef = useRef(0);
  const [now, setNow] = useState(0);

  // 进度缓动 + 运行时的脉冲帧
  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      animRef.current = progress;
      setNow(Date.now());
      return;
    }

    const tick = () => {
      const diff = progress - animRef.current;
      const settled = Math.abs(diff) < 0.0004;
      animRef.current = settled ? progress : animRef.current + diff * 0.16;
      setNow(Date.now());
      if (!settled || running) rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [progress, running]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--adm-color-primary").trim() || "#0a84ff";
    const faint = css.getPropertyValue("--adm-color-border").trim() || "#3a3a3c";
    const ok = css.getPropertyValue("--adm-color-success").trim() || "#30d158";

    const p = preview;
    if (!p || !p.ok || p.points.length < 2) {
      ctx.fillStyle = css.getPropertyValue("--adm-color-weak").trim() || "#8b8b90";
      ctx.font = "500 13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p?.message || "场地就绪后显示轨迹预览", w / 2, h / 2);
      return;
    }

    const b = boundsOf([p.fence, p.points]);
    if (!b) return;

    const pad = 22;
    const cos = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
    const spanLon = Math.max(1e-7, (b.maxLon - b.minLon) * cos);
    const spanLat = Math.max(1e-7, b.maxLat - b.minLat);
    const scale = Math.min((w - pad * 2) / spanLon, (h - pad * 2) / spanLat);
    const project = (lat: number, lon: number): [number, number] => [
      w / 2 + (lon - (b.minLon + b.maxLon) / 2) * cos * scale,
      h / 2 - (lat - (b.minLat + b.maxLat) / 2) * scale,
    ];

    // 围栏
    if (p.fence.length >= 3) {
      ctx.beginPath();
      p.fence.forEach(([lat, lon], i) => {
        const [x, y] = project(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(127,127,127,0.06)";
      ctx.fill();
      ctx.strokeStyle = faint;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 推算的七条道次参考线，位于轨迹下方。
    for (const lane of p.trackLanes ?? []) {
      if (lane.length < 2) continue;
      ctx.beginPath();
      lane.forEach(([lat, lon], i) => {
        const [x, y] = project(lat, lon);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.17;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 全程（未跑部分）
    ctx.beginPath();
    p.points.forEach(([lat, lon], i) => {
      const [x, y] = project(lat, lon);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.globalAlpha = running ? 0.18 : 0.5;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 已跑部分 + 柔光
    const frac = Math.max(0, Math.min(1, animRef.current));
    const lastF = frac * (p.points.length - 1);
    const lastI = Math.floor(lastF);
    if (lastI >= 1) {
      ctx.beginPath();
      for (let i = 0; i <= lastI; i++) {
        const [x, y] = project(p.points[i][0], p.points[i][1]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      if (lastI < p.points.length - 1) {
        const t = lastF - lastI;
        const [ax, ay] = project(p.points[lastI][0], p.points[lastI][1]);
        const [bx, by] = project(p.points[lastI + 1][0], p.points[lastI + 1][1]);
        ctx.lineTo(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
      ctx.save();
      ctx.shadowColor = accent;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 起点
    const [sx, sy] = project(p.points[0][0], p.points[0][1]);
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fillStyle = ok;
    ctx.fill();

    // 当前位置
    const idx = Math.min(Math.max(lastI, 0), p.points.length - 1);
    const [px, py] = project(p.points[idx][0], p.points[idx][1]);
    if (running) {
      const phase = (now % 1600) / 1600;
      ctx.beginPath();
      ctx.arc(px, py, 7 + phase * 12, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.globalAlpha = (1 - phase) * 0.26;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(px, py, 4.4, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }, [preview, running, now]);

  return (
    <div
      ref={wrapRef}
      style={{
        height,
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--adm-color-box)",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
