# AGENT.md · 小雨run 桌面版

本文件说明 `desktop/` 的架构约束。改代码前先读。

---

## 1. 基本信息

| 项 | 内容 |
|---|---|
| 名称 | 小雨run（XiaoYu Run） |
| 版本 | v3.2.9 |
| 技术栈 | Rust 2021 + Tauri 2 + React 18 + TypeScript + Motion |
| 仓库 | https://github.com/yhan-sun/xiaoyu-run |
| 目标服务 | `https://sport.cqupt.edu.cn/new_wxapp` |

> 历史文档里“没有 React / 不引 UI 框架”的说法已经过期。
> 当前前端是 React，设计系统由 `src/styles/tokens.css` 与
> `src/components/ui/` 自己维护；不依赖组件库的默认外观。

---

## 2. 分层与边界

```
前端 (React / TypeScript)   只做呈现：DOM、CSS、Canvas、事件、动效
   ↕ invoke / emit
Rust (Tauri)                全部计算与网络：轨迹、协议、调度、持久化
```

**硬约束：**

1. **前端不碰网络。** 所有 HTTP 在 `api.rs`。前端只调命令。
2. **前端不做几何计算。** 轨迹、配速、围栏判定都在 `track.rs` / `geo.rs`。
   Canvas 只负责把返回的经纬度投到屏幕上。
3. **不改 IPC 契约。** 命令名、参数、返回结构和 `invoke_handler` 保持一致；
   UI 重构不能改变结果判定、数据模型或业务语义。
4. **颜色只走 token。** 新增颜色写进 `styles/tokens.css`，组件里不写死 hex；
   深色主题单独调整，不做简单反转。
5. **业务状态只有一个来源。** 页面不持有 run / stats / config 的副本；
   统一由 `hooks/useXiaoyu.ts` 管理，页面只接收 props。
6. **动效必须可关闭。** 任何新增 Motion 动效都要读 `useReducedMotion`；
   不使用无限装饰动画、荧光光晕或大面积呼吸效果。

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
| `src/App.tsx` | 外壳、导航、页面切换、滚动恢复、健康探针 | 不要写业务规则 |
| `src/hooks/useXiaoyu.ts` | IPC 调用、配置、预览、运行事件、成绩、互斥锁 | 不要做几何计算 |
| `src/TrackCanvas.tsx` | 经纬度投影、轨道绘制、进度缓动 | 不要改点序/算法 |
| `src/components/run` | 运动仪表盘、参数、场地选择、CTA | 不要直接 invoke |
| `src/components/stats` | 总览、场地分布、记录列表 | 不要编造时间序列 |
| `src/components/guide` | 三步配置、OpenID 遮盖、帮助折叠 | 不要明文展示 OpenID |
| `src/components/settings` | 设置列表、主题、危险操作 | 不要在打卡中清空 |
| `src/components/extract` | 桌面端沉浸式取码 | 不要上传任何数据 |
| `src/components/ui` | 设计系统原子组件 | 不要写页面业务 |
| `src/lib/format.ts` | 纯格式化 / 输入校验 / 遮盖 | 不要改后端结果 |
| `src/styles/*` | tokens / base / animations / app | 不要写内联品牌色 |

---

## 4. 几个容易踩的点

1. **上传节拍对齐单调时钟。**
   每批的目标时刻 = 起点 + 本批末点的 `secOffset`，**不是批大小**。
   相邻批共享首末点，按 8 秒等会把整轮拖长 ~14%，服务端按 `collectTime`
   跨度算时长，多睡的全记进配速里。

2. **`isValid` 逐点判定。**
   落在禁跑区的点标 `"2"`（不计里程），不是恒为 `"1"`。

3. **`start2` 会接续上次没结束的记录。**
   先查 `sportRecordInfo`，有点数就先 `end` 再重开，否则界面一进去就跳一半。

4. **Canvas 不要每帧 setState。**
   进度插值放在 `requestAnimationFrame` + refs 里；只在尺寸/预览/主题变化时重绘，
   运行态才保留脉冲循环。否则长时间打卡会持续触发 React 渲染。

5. **启动/停止需要 ref 级互斥。**
   `starting` / `stopping` 的 React state 在同一个 tick 内可能还是旧值；
   `useXiaoyu` 里的 `startBusy` / `stopBusy` 是最终防线。

---

## 5. 提交前检查

```bash
cd desktop
npm run build          # tsc --noEmit + vite build
npm test               # 纯函数单测（node:test）
cd src-tauri && CARGO_HOME=../../.cargo-home cargo test
cargo clippy -- -D warnings   # 建议
```

- [ ] 新增命令记得加进 `invoke_handler`，并保持 camelCase 返回
- [ ] 新增颜色写进 `styles/tokens.css`，浅色/深色都要看
- [ ] 新增动效读 `useReducedMotion`
- [ ] 移动端 390 / 430，桌面 1024 / 1180 / 1280 都要过一遍
- [ ] OpenID、token、日志里的敏感值不得明文进入 UI
