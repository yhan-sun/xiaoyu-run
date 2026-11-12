# AGENT.md · 小雨run 项目规范

本文件是「小雨run」项目的架构说明与开发规范。
动手改代码之前先读完，提交之前遵循核心检查清单。

---

## 1. 项目基本信息

| 项 | 内容 |
|---|---|
| 名称 | 小雨run（XiaoYu Run） |
| 一句话 | 专为校园健康跑设计的极简原生安卓客户端，参考 Apple 顶级美学与设计系统重构 |
| 作者 | 小雨 (yuhan) |
| 当前版本 | **v2.0.0**（`versionCode 20000` / `versionName "2.0.0"`） |
| License | MIT |
| 仓库 | https://github.com/yhan-sun/xiaoyu-run |
| 目标服务 | `https://sport.cqupt.edu.cn/new_wxapp`（重邮智慧体育小程序后端） |

---

## 2. 核心架构与设计原则

1. **零第三方依赖**：
   - 坚持纯原生 Android Framework（`HttpURLConnection` + `org.json` + `Canvas` 自定义绘制）。
   - 杜绝臃肿的三方库（无 Retrofit/OkHttp/RxJava），保持数十毫秒级极速冷启动与极低安装包体积。
2. **纯本地无侵入**：
   - 不申请地理位置（GPS）权限，所有打卡点在本地算法层直接生成并上传。
   - OpenID 仅存储在本机私有 `SharedPreferences`，严禁上传至任何第三方服务器。
3. **Apple HIG 视觉设计规范**：
   - 浅色采用 `#F2F2F7` 柔和背景配合纯白圆角卡片，深色采用 `#000000` 纯粹暗黑底色与 `#1C1C1E` 层次卡片。
   - 20dp 连续圆角卡片、Apple System Blue 主题、无生硬纯黑粗线。
   - `TrackCanvasView` 提供动态拟真操场环道与呼吸光环。
4. **长时巡航保活**：
   - 前台服务 `RunService` 配合 `PowerManager.WakeLock`，保障锁屏放入兜里 12 分钟内网络节拍平稳上报。

---

## 3. 提交前检查清单

- [ ] 版本号：`app/build.gradle.kts` 中 `versionCode` 与 `versionName` 一致
- [ ] 单元测试：`./gradlew test` 全部通过
- [ ] 资源规范：所有字符串归集于 `strings.xml`，所有颜色归集于 `colors.xml`
