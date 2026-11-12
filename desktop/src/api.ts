import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function call<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isTauri) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(String(e));
  }
}

export const on = listen;

// ---------------------------------------------------------------- 类型

export interface Area {
  placeName: string;
  placeCode: string;
  fenceVertices: number;
  banCount: number;
}

export interface Rule {
  minPace: number;
  maxPace: number;
  raceMile: number;
}

export interface ConnectResult {
  ok: boolean;
  message: string;
  tokenMasked: string;
  rule: Rule | null;
  areas: Area[];
  logs: string[];
}

export interface PreviewResult {
  ok: boolean;
  message: string;
  fence: [number, number][];
  points: [number, number][];
  paceSecKm: number;
  windowLo: number;
  windowHi: number;
  inWindow: boolean;
  count: number;
  adjusted: boolean;
  distanceM: number;
  trackNote: string;
  trackLanes: [number, number][][];
}

export interface RunState {
  phase: string;
  pointsDone: number;
  pointsTotal: number;
  metersDone: number;
  metersTotal: number;
  elapsedSec: number;
  etaSec: number;
  paceSecKm: number;
  paceLo: number;
  paceHi: number;
  batchesDone: number;
  batchesTotal: number;
  serverMileage: number;
  serverSeconds: number;
  finished: boolean;
  failed: boolean;
}

export interface StatRow {
  place: string;
  km: number;
  sec: number;
  duration: string;
  valid: boolean;
  reason: string;
}

export interface Stats {
  total: number;
  validCount: number;
  invalidCount: number;
  totalKm: number;
  avgPaceSecKm: number;
  byPlace: [string, number][];
  rows: StatRow[];
}

export interface FoundOpenid {
  openid: string;
  cqupt: boolean;
  source: string;
}

export interface ExtractResult {
  found: FoundOpenid[];
  note: string;
  scannedDirs: number;
  scannedFiles: number;
  deniedDirs: number;
  qr: string | null;
}

export interface PowerStatus {
  platform: string;
  caffeinate: boolean;
  sleepMinutes: number | null;
  onBattery: boolean;
  runningAwake: boolean;
}

export interface Config {
  openid: string;
  pace: string;
  dist: string;
  noise: number;
  burrs: boolean;
  seed: number;
  placeCode: string;
  theme: string;
  keepAwake: boolean;
  lastStats: Stats | null;
}

export const DEFAULT_CONFIG: Config = {
  openid: "",
  pace: "5:45",
  dist: "2.0",
  noise: 0.6,
  burrs: true,
  seed: 0,
  placeCode: "",
  theme: "dark",
  keepAwake: true,
  lastStats: null,
};

// ---------------------------------------------------------------- 格式化

export function fmtPace(sec: number): string {
  if (!sec || sec <= 0 || sec > 3600) return "--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}

export function fmtDuration(sec: number): string {
  if (sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 粘贴常带换行、引号、`openid=` 前缀，统一洗掉。 */
export function sanitizeOpenid(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^openid\s*[:=]\s*/i, "");
  v = v.replace(/^["'`]|["'`]$/g, "");
  return v.replace(/\s+/g, "");
}

export function openidHint(v: string): { text: string; bad: boolean } {
  if (!v) return { text: "", bad: false };
  if (v.length < 16) return { text: "长度偏短，确认是否粘贴完整", bad: true };
  if (!/^[A-Za-z0-9_-]+$/.test(v))
    return { text: "含非法字符，只应有字母、数字、下划线", bad: true };
  if (!v.startsWith("o") || v.length !== 28)
    return { text: `已填入 ${v.length} 位（常见为 28 位且以 o 开头）`, bad: false };
  return { text: "格式正常", bad: false };
}
