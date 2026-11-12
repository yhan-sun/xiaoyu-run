# AGENT.md · 小雨run 桌面版

本文件说明 `desktop/` 的架构约束。改代码前先读。

---

## 1. 基本信息

| 项 | 内容 |
|---|---|
| 名称 | 小雨run（XiaoYu Run） |
| 版本 | v3.0.0 |
| 技术栈 | Rust 2021 + Tauri 2 + TypeScript（无框架） |
| 仓库 | https://github.com/yhan-sun/xiaoyu-run |
| 目标服务 | `https://sport.cqupt.edu.cn/new_wxapp` |

---

## 2. 分层与边界

```
前端 (TypeScript)     只做呈现：DOM、CSS、Canvas、事件
   ↕ invoke / emit
Rust (Tauri)          全部计算与网络：轨迹、协议、调度、持久化
```

**硬约束：**

1. **前端不碰网络。** 所有 HTTP 在 `api.rs`。前端只调命令。
2. **前端不做几何计算。** 轨迹、配速、围栏判定都在 `track.rs` / `geo.rs`。
   Canvas 只负责把返回的经纬度投到屏幕上。
3. **不引 UI 框架。** 没有 React/Vue。DOM 是本项目最大的可控面，
   上框架等于把设计系统交给别人。
4. **零第三方运行时依赖。** Rust 侧只用 tauri / serde / ureq / chrono。

---

## 3. 模块职责

| 文件 | 职责 | 不该做的事 |
|---|---|---|
| `geo.rs` | haversine、方位角、大圆推算、射线法 | 不要放业务逻辑 |
| `rng.rs` | 确定性 SplitMix64 | 不要引 `rand` |
| `track.rs` | 轨迹生成全流程 | 不要发网络请求 |
| `api.rs` | 协议端点与响应包装 | 不要做业务流程编排 |
| `run.rs` | 打卡编排：start2 → 分批 → end | 不要直接碰前端 |
| `lib.rs` | Tauri 命令、配置、事件 | 不要塞算法 |
| `src/main.ts` | 页面状态、IPC 调用、Canvas | 不要写业务规则 |

---

## 4. 三个容易踩的点

1. **上传节拍对齐单调时钟。**
   每批的目标时刻 = 起点 + 本批末点的 `secOffset`，**不是批大小**。
   相邻批共享首末点，按 8 秒等会把整轮拖长 ~14%，服务端按 `collectTime`
   跨度算时长，多睡的全记进配速里。

2. **`isValid` 逐点判定。**
   落在禁跑区的点标 `"2"`（不计里程），不是恒为 `"1"`。

3. **`start2` 会接续上次没结束的记录。**
   先查 `sportRecordInfo`，有点数就先 `end` 再重开，否则界面一进去就跳一半。

---

## 5. 提交前检查

```bash
cd desktop
npx tsc --noEmit                      # 前端类型
cd src-tauri && cargo test            # Rust 测试（9 项）
cargo clippy -- -D warnings           # 建议
```

- [ ] 新增文案走 `index.html` 或常量，不要在 TS 里散落中文字符串
- [ ] 颜色只用 `styles.css` 里的 CSS 变量，不写死 hex
- [ ] 新增命令记得加进 `invoke_handler`
