/**
 * Pure presentation helpers.
 *
 * Nothing in here changes the run result: pace/distance parsing mirrors the
 * backend's input rules purely so the form can explain invalid values before
 * an IPC call. The Rust side remains the single source of truth.
 */

export type StatusTone = "accent" | "success" | "warning" | "danger" | "neutral";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** "5:45" / "345" / `5'45"` → seconds per km, or null. */
export function parsePaceSeconds(value: string): number | null {
  // Accept the notation the app itself prints (`5'45"`) as well as `5:45`.
  // The value sent over IPC is normalized to `5:45` in the controller.
  const t = value
    .trim()
    .replace(/["″]/g, "")
    .replace(/['’]/g, ":");
  if (!t) return null;
  if (t.includes(":")) {
    const [mRaw, sRaw, extra] = t.split(":");
    if (extra !== undefined) return null;
    const m = Number(mRaw.trim());
    const s = Number(sRaw.trim());
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    if (m < 0 || s < 0 || s >= 60) return null;
    const total = m * 60 + s;
    return total > 0 ? total : null;
  }
  const v = Number(t);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

export function formatPaceInput(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Step the target pace by ±delta seconds, keeping a 3:00–20:00 range. */
export function adjustPace(value: string, deltaSec: number): string {
  const current = parsePaceSeconds(value);
  if (current === null) return value;
  return formatPaceInput(clamp(current + deltaSec, 180, 1200));
}

/** Backend accepts 0.1–100 km; mirror only for inline feedback. */
export function parseDistanceKm(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  if (v < 0.1 || v > 100) return null;
  return v;
}

export function adjustDistance(value: string, deltaKm: number): string {
  const current = parseDistanceKm(value);
  if (current === null) return value;
  return clamp(current + deltaKm, 0.1, 100).toFixed(1);
}

export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(clamp(done / total, 0, 1) * 100);
}

/** Never show a full credential in a view that can be glanced at. */
export function maskOpenid(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (v.length <= 8) {
    return `${v.slice(0, 2)}${"•".repeat(Math.max(4, v.length - 2))}`;
  }
  const dots = clamp(v.length - 8, 6, 10);
  return `${v.slice(0, 4)}${"•".repeat(dots)}${v.slice(-4)}`;
}

export function formatSyncLabel(lastSync: number | null, now = Date.now()): string {
  if (!lastSync) return "本机缓存";
  const diff = Math.max(0, now - lastSync);
  if (diff < 45_000) return "刚刚同步";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} 分钟前同步`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前同步`;
  return `${Math.floor(hour / 24)} 天前同步`;
}

export interface RunLike {
  phase: string;
  finished: boolean;
  failed: boolean;
  metersDone: number;
  metersTotal: number;
  elapsedSec: number;
  paceSecKm: number;
}

export function runMeta(run: RunLike | null): {
  tone: StatusTone;
  label: string;
  detail: string;
  live: boolean;
} {
  if (!run) {
    return { tone: "neutral", label: "待命", detail: "等待开始", live: false };
  }
  if (run.failed) {
    return { tone: "danger", label: "已中断", detail: run.phase, live: false };
  }
  if (run.finished) {
    return { tone: "success", label: "已完成", detail: run.phase, live: false };
  }
  return { tone: "accent", label: "进行中", detail: run.phase, live: true };
}

/** Actual average pace of a finished run, seconds/km. 0 when not computable. */
export function resultPace(run: RunLike): number {
  if (run.metersDone <= 0 || run.elapsedSec <= 0) return 0;
  return run.elapsedSec / (run.metersDone / 1000);
}

export function recordAdvice(reason: string): string {
  const r = reason || "";
  if (/配速|速度|pace/i.test(r)) {
    return "目标配速可能超出该场地的规则区间。回到运动页调慢或调快配速，再跑一次。";
  }
  if (/距离|里程|达标|mile/i.test(r)) {
    return "本次距离没有达到该场地的达标里程。增加目标距离后再开始。";
  }
  if (/区域|围栏|禁跑|越界|gps/i.test(r)) {
    return "轨迹点可能落在围栏或禁跑区之外。先重新同步场地，再试一次。";
  }
  if (/人脸|核验|签到/i.test(r)) {
    return "人脸核验在操场摄像头侧完成，工具无法代替。需要本人到场后重新开始。";
  }
  return "可先重新同步成绩确认服务端判定；若仍然失败，请检查场地、目标距离与配速是否符合当次规则。";
}

export function isPaceInWindow(
  paceSec: number,
  lo: number,
  hi: number
): boolean {
  if (!paceSec || !lo || !hi) return true;
  return paceSec >= lo && paceSec <= hi;
}
