# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，遵循语义化版本（`MAJOR.MINOR.PATCH`）。

---

## [2.0.0] — 2026-11-12 · 全新品牌「小雨run」与 Apple 级顶级 UI/UX 重构

### 重大变更
- **品牌全新升级**：更名为「小雨run」（XiaoYu Run），包名迁移至 `com.xiaoyu.run`，版本升至 `v2.0.0`。
- **顶级 UI/UX 重构**：
  - 彻底去除 AI/机械感与旧版粗糙样式，全面遵循 Apple HIG 人机交互规范。
  - 打造高品质深浅色无缝自适应主题（纯黑底色与层次高对比悬浮卡片）。
  - 新增 `TrackCanvasView` 动态拟真操场环道视图，支持运动呼吸脉冲与实时节点巡航绘制。
  - 悬浮半透明底栏（Floating Dock）、精美分段器与 Apple 风格图标系统。
- **项目结构精简升级**：
  - 将安卓原生 App 提至仓库根目录，标准工程结构。
  - 解耦辅助脚本 `tools/get_openid.py`，移动端只负责极致纯粹的运动与打卡体验。
  - 新增 GitHub Actions 自动化 CI/CD，推送到 main 分支自动编译、打包、测试并发布 APK Release。
