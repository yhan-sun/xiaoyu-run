import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Node 20-compatible test bootstrapping: transpile the pure helper module with
// the TypeScript already installed for the build, then import it as ESM.
// This keeps `npm test` working on the Node 20 used by CI and on newer nodes.
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/lib/format.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2021,
  },
}).outputText;
const generated = path.join(here, ".format.mjs");
fs.writeFileSync(generated, compiled);

const {
  adjustDistance,
  adjustPace,
  formatPaceInput,
  formatSyncLabel,
  isPaceInWindow,
  maskOpenid,
  parseDistanceKm,
  parsePaceSeconds,
  progressPercent,
  recordAdvice,
  resultPace,
  runMeta,
} = await import(pathToFileURL(generated).href);


test("parses the three pace notations the backend accepts", () => {
  assert.equal(parsePaceSeconds("5:45"), 345);
  assert.equal(parsePaceSeconds("345"), 345);
  assert.equal(parsePaceSeconds(`5'45"`), 345);
  assert.equal(parsePaceSeconds(" 6:05 "), 365);
});

test("rejects malformed or impossible pace values", () => {
  assert.equal(parsePaceSeconds(""), null);
  assert.equal(parsePaceSeconds("abc"), null);
  assert.equal(parsePaceSeconds("5:75"), null);
  assert.equal(parsePaceSeconds("1:2:3"), null);
  assert.equal(parsePaceSeconds("-5"), null);
});

test("pace stepper stays inside a humane range", () => {
  assert.equal(adjustPace("5:45", 5), "5:50");
  assert.equal(adjustPace("2:50", -5), "3:00");
  assert.equal(adjustPace("19:58", 5), "20:00");
  assert.equal(formatPaceInput(345), "5:45");
});

test("distance validation mirrors the backend 0.1–100 km range", () => {
  assert.equal(parseDistanceKm("2.0"), 2);
  assert.equal(parseDistanceKm("0.1"), 0.1);
  assert.equal(parseDistanceKm("100"), 100);
  assert.equal(parseDistanceKm("0"), null);
  assert.equal(parseDistanceKm("100.1"), null);
  assert.equal(parseDistanceKm("x"), null);
  assert.equal(adjustDistance("2.0", 0.5), "2.5");
  assert.equal(adjustDistance("0.1", -0.5), "0.1");
  assert.equal(adjustDistance("99.9", 0.5), "100.0");
});

test("progress clamps and never divides by zero", () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(1000, 2000), 50);
  assert.equal(progressPercent(3000, 2000), 100);
  assert.equal(progressPercent(-10, 2000), 0);
});

test("openid masking never exposes the middle of a credential", () => {
  assert.equal(maskOpenid(""), "");
  assert.equal(maskOpenid("o1234567"), "o1••••••");
  const masked = maskOpenid("oQ7d3nLx9kP2mWs8vB4cR6tY1zH5jF0aK3eN7uG2");
  assert.equal(masked.startsWith("oQ7d"), true);
  assert.equal(masked.endsWith("7uG2"), true);
  assert.equal(masked.includes("nLx9"), false);
  assert.equal(masked.includes("•"), true);
});

test("sync labels degrade from now to cached", () => {
  const now = 1_000_000_000;
  assert.equal(formatSyncLabel(null, now), "本机缓存");
  assert.equal(formatSyncLabel(now - 10_000, now), "刚刚同步");
  assert.equal(formatSyncLabel(now - 5 * 60_000, now), "5 分钟前同步");
  assert.equal(formatSyncLabel(now - 3 * 3600_000, now), "3 小时前同步");
  assert.equal(formatSyncLabel(now - 50 * 3600_000, now), "2 天前同步");
});

test("run status uses backend flags without rewriting them", () => {
  assert.equal(runMeta(null).tone, "neutral");
  assert.equal(
    runMeta({
      phase: "上传中",
      finished: false,
      failed: false,
      metersDone: 1,
      metersTotal: 2,
      elapsedSec: 1,
      paceSecKm: 345,
    }).tone,
    "accent"
  );
  assert.equal(
    runMeta({
      phase: "已完成",
      finished: true,
      failed: false,
      metersDone: 2,
      metersTotal: 2,
      elapsedSec: 690,
      paceSecKm: 345,
    }).tone,
    "success"
  );
  assert.equal(
    runMeta({
      phase: "失败：start2 网络",
      finished: false,
      failed: true,
      metersDone: 0,
      metersTotal: 2,
      elapsedSec: 3,
      paceSecKm: 345,
    }).tone,
    "danger"
  );
});

test("result pace is derived only when there is data", () => {
  assert.equal(
    resultPace({
      phase: "",
      finished: true,
      failed: false,
      metersDone: 2000,
      metersTotal: 2000,
      elapsedSec: 690,
      paceSecKm: 345,
    }),
    345
  );
  assert.equal(
    resultPace({
      phase: "",
      finished: true,
      failed: false,
      metersDone: 0,
      metersTotal: 2000,
      elapsedSec: 690,
      paceSecKm: 345,
    }),
    0
  );
});

test("record advice maps failure text to an actionable hint", () => {
  assert.match(recordAdvice("配速超出规则区间"), /配速/);
  assert.match(recordAdvice("目标距离低于达标里程"), /距离/);
  assert.match(recordAdvice("轨迹点超出围栏"), /围栏/);
  assert.match(recordAdvice(""), /重新同步/);
});

test("pace window helper is permissive when bounds are absent", () => {
  assert.equal(isPaceInWindow(345, 0, 0), true);
  assert.equal(isPaceInWindow(345, 325, 365), true);
  assert.equal(isPaceInWindow(300, 325, 365), false);
});
