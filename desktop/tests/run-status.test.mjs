import test from "node:test";
import assert from "node:assert/strict";
import { describeRunStatus } from "../src/run-status.mjs";

test("a 403 or unconfirmed upload never looks like a successful settlement", () => {
  for (const phase of ["失败：结算未确认", "失败：上传未确认", "失败：上次记录未结算", "失败：无法检查已有记录", "失败：start2 网络", "失败：无记录号", "失败：无法开始新记录"]) {
    const notice = describeRunStatus({ phase, failed: true, finished: false }, true);
    assert.equal(notice.kind, "warning");
    assert.equal(notice.needsReview, true);
    assert.match(notice.description, /官方小程序/);
  }
});

test("settlement and stop remain pending until a server-confirmed finish", () => {
  assert.equal(describeRunStatus({ phase: "结算中", failed: false, finished: false }, false).title, "正在结算");
  assert.equal(describeRunStatus({ phase: "上传中", failed: false, finished: false }, true).title, "正在停止");
  assert.equal(describeRunStatus({ phase: "已完成", failed: false, finished: true }, false).kind, "success");
  assert.equal(describeRunStatus({ phase: "上传中", failed: false, finished: false }, false), null);
});
