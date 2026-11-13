# Visual QA harness（仅视觉验收）

这个目录**不参与生产构建**。`vite build` 的入口仍是根目录 `index.html`。

用途：在没有有效校园跑 OpenID / 校园网凭据时，渲染运行中、已完成、成绩有数据等
界面状态，用于截图与视觉回归。它通过 `mock-tauri.js` 注入一个最小 Tauri IPC
桥，返回与真实命令相同形状的数据；页面、组件、CSS、Canvas 全部是生产代码。

```bash
cd desktop
npm run dev
# 打开 http://127.0.0.1:5273/visual.html
```

可用 query：

- `data=ready|none`：是否已配置身份/场地
- `theme=light|dark`
- `stats=full|empty|none`
- `run=running|finished|failed`：自动注入一次运行状态
- `tab=run|stats|guide|settings|extract`：自动切页

**边界**：这里的场地、成绩与运行状态不是产品数据，也不会写回应用配置；
生产代码没有 demo 数据分支。截图仅用于本地视觉验收。
