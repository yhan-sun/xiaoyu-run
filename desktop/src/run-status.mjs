/** Presentation of server-confirmed and unconfirmed run states. */
export function describeRunStatus(run, stopping) {
  if (!run) return null;
  if (run.failed) {
    const needsReview = /未确认|未结算|无法检查已有记录|start2 网络|无记录号|无法开始新记录/.test(run.phase);
    return {
      kind: "warning",
      title: needsReview ? "记录状态尚未确认" : "操作未完成",
      description: needsReview
        ? "操作未得到服务器确认，记录可能仍在进行。请先在官方小程序检查并处理。"
        : "请查看运行日志了解原因，再决定下一步。",
      showLogs: true,
      needsReview,
    };
  }
  if (run.finished) return {
    kind: "success",
    title: "记录已结束",
    description: "服务器已确认结束；成绩和是否达标请以成绩页为准。",
    showLogs: false,
    needsReview: false,
  };
  if (run.phase === "结算中") return {
    kind: "info",
    title: "正在结算",
    description: "正在等待服务器确认，请保持应用在前台。",
    showLogs: false,
    needsReview: false,
  };
  if (stopping) return {
    kind: "info",
    title: "正在停止",
    description: "已收到停止请求，正在等待当前操作完成。",
    showLogs: false,
    needsReview: false,
  };
  return null;
}
