# 小雨run · XiaoYu Run

> 校园运动客户端。**电脑端取码 + 手机端打卡**，Rust 驱动，本地计算。

<p align="center">
  <img src="desktop/src-tauri/icons/128x128@2x.png" width="104" alt="小雨run" />
</p>

---

## 两个部件

| 部件 | 平台 | 干什么 | 下载 |
|---|---|---|---|
| **取码工具** | Windows | 读取微信缓存，显示 OpenID 和二维码 | [xiaoyu-run.exe](https://github.com/yhan-sun/xiaoyu-run/releases/tag/v3.1.0-win) |
| **电脑端界面版** | Windows / macOS | 可视化取码 + 打卡参数预览 | [安装包](https://github.com/yhan-sun/xiaoyu-run/releases/tag/v3.1.0-win) |
| **手机端** | Android 7.0+ · arm64 | 扫码或输入 → 生成轨迹 → 打卡（React + Ant Design Mobile） | [Android APK](https://github.com/yhan-sun/xiaoyu-run/releases/tag/v3.0.0-android) |

**为什么必须分成两半**：微信把小程序数据放在手机的应用私有目录
（`/data/data/com.tencent.mm`），未 root 的手机读不到 —— 这是 Android 沙箱，不是工具问题。
而电脑版微信把小程序跑在 Chromium 里，网络缓存是**明文 JSON**，所以只有电脑能取。

---

## 用法

### 1. 电脑端取码（只做一次）

**方式 A：独立小工具（推荐）**

双击 `xiaoyu-run.exe`，点击「获取 OpenID」，使用二维码或复制 OpenID。缓存中可可靠关联的姓名、学号和统一认证码也会显示。

**方式 B：界面版**

打开安装包，点「扫描本机微信」，左侧出二维码、右侧出明文。

两种方式都要求：电脑微信里打开过一次「重邮智慧体育」小程序并完成绑定。

> **macOS 提示无权限**：系统设置 → 隐私与安全性 → **完全磁盘访问权限**，
> 勾选小雨run，再回来重新扫描。读别的应用的沙箱容器必须给这个权限。

> 手机端只提供 **arm64（arm64-v8a）** 包，覆盖 2016 年之后几乎所有安卓机型。

### 2. 手机端导入

- **扫码**：指南页 →「扫码」→ 对准电脑上的二维码
- **手动**：把 OpenID 发到手机，粘贴进输入框（会自动清洗空格、引号、`openid=` 前缀）

OpenID 只需要填一次，之后永久保存在本机。

### 3. 打卡

1. 「指南」页点「保存并同步场地」
2. 「运动」页选场地、配速、距离（拖配速滑块时轨迹**实时重算**）
3. 到操场点「开始打卡」，**保持应用在前台**（可调低亮度）
4. 跑满目标距离自动结算

> ⚠️ Android 没有可申请的「省电白名单」。打卡期间切到后台或锁屏，系统可能挂起进程。
> 人脸核验在操场摄像头侧完成，工具无法绕开 —— **必须本人到场**。

---

## 轨迹引擎

Rust 实现，与原 Kotlin 版同构，但用显式结构体替代闭包捕获。

1. **配速标定** — 点数由「配速 × 距离」锁死（2 km @ 5'45" = 690 点），
   二分反解地面步长，使实测距离等于目标距离
2. **围栏内缩** — 从 0.90 逐档向内试，取第一个完全合法的基准环
3. **有机化** — 六条整数圈正弦 + 局部鼓包 + 滑动平均
4. **平滑游走** — 三档升余弦包络（1.2~8.5 m / 5~40 s），两端导数为零，**不会出现尖刺**
5. **变道** — 「保持 → 半周期余弦 S 形过渡（3~6 秒）→ 保持」，模拟真实换道，
   约每 30~80 秒换一次，幅度 1.2~3.6 m（一条跑道宽约 1.22 m）
6. **四层 AR(1) 噪声** — ρ = 0.997 / 0.970 / 0.850 / 0.550
7. **越界不硬拽** — 沿「基准点 → 噪声点」二分回缩，保住形状

### 测试

```bash
cd desktop/src-tauri && cargo test
```

14 项通过，其中包含**形状度量**：

- `burrs_have_no_needle_spikes` —— 用「到局部弦的垂距 / 弦长」定义尖锐度，
  5 个种子实测 **0.19 ~ 0.63**（阈值 0.9）。这个指标能抓出「出峰又原路返回」的针状突起，
  单看航向变化不行（暂停时相邻点几乎重合，方位角是噪声）
- 距离误差 < 3%、配速落在窗口内、100% 点在围栏内、禁跑区 0 点
- 同种子逐点一致

---

## 工程结构

```
desktop/                    Tauri 2 应用（同时产出 Windows EXE 与 Android APK）
├── index.html              页面骨架
├── src/
│   ├── main.tsx            React 入口
│   ├── App.tsx             外壳 + 四个页面（TabBar / NavBar / Card / Selector）
│   ├── TrackCanvas.tsx     轨迹画布（Canvas + 进度缓动 + 脉冲）
│   ├── api.ts              类型与 IPC 封装
│   └── styles.css          主题令牌与布局（组件样式交给 antd-mobile）
└── src-tauri/src/
    ├── lib.rs              Tauri 命令：配置 / 连接 / 预览 / 运行 / 成绩 / 提取
    ├── extract.rs          微信缓存提取 + 二维码生成
    ├── track.rs            轨迹引擎（标定 / 内缩 / 游走 / 变道 / 噪声）
    ├── api.rs              重邮智慧体育协议
    ├── run.rs              打卡编排
    ├── geo.rs              球面几何
    └── rng.rs              确定性 SplitMix64

app/                        v2 的 Kotlin 安卓版（保留，不再更新）
tools/get_openid.py         旧版 Python 提取器（已被电脑端取代，留作参考）
```

---

## 本地构建

```bash
cd desktop
npm install

npm run app            # 开发
npm run app:build      # 打本机安装包

cd src-tauri && cargo test   # Rust 测试
```

> Cargo 缓存不可写时：`CARGO_HOME=../.cargo-home cargo test`

CI 三个工作流：`build-android.yml`（APK）、`build-windows.yml`（EXE）、
`build-apk.yml`（v2 Kotlin，仅 `app/` 变动时触发）。

---

## 免责

仅供个人学习与协议研究。请自觉遵守校纪校规，作者不对使用后果负责。

---

<p align="center">MIT · 小雨</p>
