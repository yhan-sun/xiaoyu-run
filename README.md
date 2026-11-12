# 小雨run · XiaoYu Run

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Android_7.0+-007AFF?style=flat-square&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/Design-Apple_HIG_Inspired-black?style=flat-square&logo=apple&logoColor=white" alt="Apple Design" />
  <img src="https://img.shields.io/badge/Kotlin-1.9.24-7F52FF?style=flat-square&logo=kotlin&logoColor=white" alt="Kotlin" />
  <img src="https://img.shields.io/badge/License-MIT-34C759?style=flat-square" alt="License" />
</p>

> **极简、优雅的校园运动伴侣。**  
> 一次填入 OpenID，后台平稳巡航打卡。无需后台定位、零第三方服务器、全纯本地执行。

---

## ✨ 设计哲学与核心特性

- 🍏 **Apple 级人机交互美学**
  - 遵循 Apple HIG 设计准则，采用 `#F2F2F7` 柔和画布配合纯白高对比卡片。
  - 原生自适应深色模式，呈现纯粹的 `#000000` 黑色底色与 `#1C1C1E` 层次质感。
  - 拟真呼吸动态跑道 Canvas 画板，实时渲染跑动进度与呼吸脉冲环。
- 🧭 **精准几何与轨迹拟真**
  - 基于真实操场电子围栏（dzwl）多边形自适应内缩规划基线。
  - 严格剔除禁跑区（jpq），确保每一个上报节点均计入有效里程。
  - 叠加 AR(1) 多尺度高斯噪声与微步态毛刺，消除生硬折线，回归自然运动动态。
- 🔋 **长时后台巡航保活**
  - Android 前台服务（Foreground Service）配合 CPU 局部唤醒锁（WakeLock）。
  - 支持系统电池优化白名单检测，手机放入口袋锁屏也能平稳完成调度，不丢节拍。
- 🛡️ **安全、纯净与隐私**
  - **不申请 GPS 定位权限**，直接在本地构造合法数据包上报。
  - OpenID 仅保存在手机私有 SharedPreferences，绝不外发至任何中转服务器。
  - 零第三方商业 SDK，纯净无广告。

---

## 📱 界面布局架构

```
┌─────────────────────────────────────────────────────────────┐
│  小雨run [XIAOYU RUN]                        [ 运行日志 📄 ] │
│  极简、优雅的校园运动伴侣                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ 实时运动仪表盘 ──────────────────────────────────────┐  │
│  │ 配速 5'45"/km · 巡航中                   已跑 68%     │  │
│  │ 1.36 / 2.00 km                                       │  │
│  │ ═══════════════════════●════════════                 │  │
│  │ [ 动态跑道 Canvas 视图：跑步者实时沿圈巡航 · 脉冲光环 ]  │  │
│  │ 用时 07:46 (剩余 03:12)        节点 74/99 (点位 588) │  │
│  │ 远端确认有效 1.35 km                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [ 开启巡航打卡 / 停止并结算 ] (Apple System Blue 按钮)      │
│                                                             │
│  ┌─ 运动参数配置 ────────────────────────────────────────┐  │
│  │ 场地选择: 风华运动场 (T1001)                          │  │
│  │ 配速: 5:45        距离: 2.0 km        容差: 20s/km    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [ 运动 ]       [ 统计 ]       [ 指南 ]       [ 设置 ]   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速上手指南

### 步骤 1：获取 OpenID（仅需首次操作）
OpenID 是校园跑系统的身份标识凭证，换取 Token 仅需此 ID。
1. 在电脑端微信打开「重邮智慧体育」小程序并绑定学号。
2. 运行项目内置的 `tools/get_openid.py` 脚本：
   ```bash
   python3 tools/get_openid.py
   ```
3. 复制终端输出的 OpenID。

macOS 微信 4.x 会自动检查 `~/Library/Containers/com.tencent.xinWeChat2/Data/Documents/app_data`。如果微信数据位于其他目录，可以运行 `python3 tools/get_openid.py <微信数据目录>`，或添加 `--verbose` 查看检查到的缓存目录。若仍未找到，请在电脑微信中打开小程序并完成登录后重试；缓存被清理或微信版本的缓存格式发生变化也可能导致无法提取。

### 步骤 2：在 App 中配置并开启
1. 打开 **小雨run**，前往「指南」页粘贴 OpenID 并点击 **「同步场地与规则」**。
2. 切回「运动」页，点击顶部的能效横幅，将应用加入 **后台省电白名单**。
3. 选择目标场地（如风华操场），设定配速（推荐 5:45，取规则中段区间）。
4. 抵达操场后，轻触 **「开启巡航打卡」**，将手机放入口袋。
5. 正常通过操场人脸识别摄像头一次以完成人脸核验。跑满 2 公里后应用将自动完成结算。

---

## 🛠️ 构建与测试

### 本地编译
需要 JDK 17 与 Android SDK（API 34）：

```bash
# 运行几何与配速单元测试
./gradlew test

# 构建 Release 与 Debug APK
./gradlew assembleDebug assembleRelease
```
生成的 APK 位于 `app/build/outputs/apk/release/` 与 `app/build/outputs/apk/debug/`。

### GitHub Actions CI/CD
本项目已配置自动化 GitHub Actions 工作流。每次推送到 `main` 分支均会自动执行全套测试、打包两款 APK，并自动发布至 GitHub Releases 页面供直接下载。

---

## 📄 免责声明

本项目仅供个人计算机网络通信协议分析、地理坐标变换算法研究与 Android 人机交互设计学习参考。请自觉遵守重庆邮电大学各项规章制度，合理安排户外体育锻炼。作者不对任何使用后果承担任何责任。

---

<p align="center">
  Designed & Crafted with care by <b>小雨</b> · 2026
</p>
