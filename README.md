# ZImprove (ZCode 零侵入内存增强启动器)

一套专为 **ZCode** macOS 客户端打造的零侵入、免改包、安全可靠的内存热补丁启动工具集与修复脚本。

利用 Chrome DevTools Protocol (CDP) 在应用启动时进行纯内存级别的资源拦截与注入，**无需解包或修改 `/Applications/ZCode.app` 安装文件，不破坏 macOS 应用签名，不触发系统安全拦截（Gatekeeper / SIP）**，客户端更新后亦可无缝沿用。

---

## 🌟 核心特性

### 1. 纯内存热补丁，零改包、零破坏签名
- **100% 用户空间与内存运作**：启动时直接解析 `app.asar` 头部偏移提取目标脚本，通过 CDP `Fetch` 协议在内存中替换前端核心代码。
- **不篡改原应用包**：完全不动 `/Applications/ZCode.app` 任何二进制或 asar 文件，macOS 签名安全完好，随官方版本更新不失效。

### 2. 免登录与虚拟用户就绪
- **屏蔽全屏登录/欢迎弹窗**：切断启动时的强制账号检测守卫（`GJt`）与全屏遮罩组件渲染分支（`aKt`），无论离线还是未登录状态，绝不弹窗阻断。
- **注入本地虚拟用户**：动态将虚拟就绪用户信息（`user:{id:"local_user"}`）注入客户端状态树，确保客户端内部业务与鉴权状态始终保持正常。

### 3. 解除多模态与附件限制
- **放行 `/plan` 快捷指令附件**：修复官方对 `/plan` 指令输入图片或附件时的强行阻断（`unsupportedPlanShortcut`），允许带图执行计划模式。
- **解除视觉模型屏蔽**：解锁对 GLM 等模型的视觉能力强制屏蔽（修复 `ZR` 函数限制）。
- **同步用户模型能力配置**：自动扫描并修补 `~/.zcode` 用户目录配置（`provider_config.json`、`cli/config.json` 以及内置规则缓存），批量启用 `supportsImage` 与 `supportsPdf`。

### 4. 纯净界面定制
- **精简化侧边栏**：通过 React 渲染层（AST 清空）及动态 CSS 注入，隐去左下角用户头像与昵称，仅保留系统设置齿轮图标。
- **直达模型设置**：启动后自动定位并展开“模型服务商设置（Model Provider）”界面，消除“加载中...”骨架占位，默认选中首个自定义供应商，零抖动。
- **净化预置推广**：自动过滤智谱预置项及订阅促销卡片，专注自定义 API / 模型服务。

### 5. 智能守护与平滑生命周期
- **自动检测与重启**：启动时若 ZCode 正在运行但未开启调试接口，支持自动优雅退出并重新携带参数拉起。
- **零残留自动退出**：CDP 会话随 ZCode 主窗口关闭而自动平滑退出，附带心跳进程检测保底，杜绝孤儿进程与后台资源浪费。

---

## 📁 仓库文件说明

| 文件名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `zcode-cdp-launcher.mjs` | Node.js 核心脚本 | 基于 CDP 的纯内存拦截器与启动注入守护进程 |
| `启动ZCode(多模态解锁).command` | Shell 脚本 (macOS) | macOS 双击快捷运行脚本，自动识别环境并拉起守护进程 |
| `0001-Fix-version-downgrade-when-re-patching-an-updated-Cl.patch` | Git 补丁 | 解决 Claude Desktop 补丁升级时误还原旧备份导致版本回滚问题的修复补丁 |
| `.gitignore` | 配置 | 忽略 `.DS_Store`、日志文件（`*.log`）等临时文件 |

---

## 🛠️ 环境要求

- **操作系统**：macOS (Apple Silicon / Intel)
- **目标应用**：ZCode.app 已安装在 `/Applications/ZCode.app`
- **运行环境**：Node.js >= 22.0.0（支持 `mise`、`nvm`、`Homebrew` 安装的 Node）

---

## 🚀 使用方法

### 方式一：macOS 图标双击启动（推荐）

1. 直接双击运行 `启动ZCode(多模态解锁).command`；
2. 终端窗口将自动定位 Node.js 路径并启动守护进程；
3. ZCode 启动完成后终端将在 2 秒后自动退出，后台守护进程随 ZCode 保持运行。

> **提示**：如果双击提示没有权限，可在终端中执行一次：
> ```bash
> chmod +x "启动ZCode(多模态解锁).command" zcode-cdp-launcher.mjs
> ```

---

### 方式二：终端命令行启动

通过 Node.js 直接执行启动器：

```bash
# 标准启动（如检测到未开启调试端口的 ZCode 将提示并平滑重启）
node zcode-cdp-launcher.mjs

# 自动平滑重启正在运行的 ZCode 并注入
node zcode-cdp-launcher.mjs --restart

# 指定自定义 CDP 调试端口（默认 9333）
node zcode-cdp-launcher.mjs --port=9333
```

#### 命令行参数说明

| 参数 | 简写 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `--port=<port>` | - | `9333` | 指定 CDP 远程调试监听端口（默认避开 Chrome 的 9222） |
| `--restart` | `-r` | `false` | 若已存在未开启调试端口的 ZCode 进程，自动安全重启 |
| `--help` | `-h` | - | 打印帮助信息 |

---

## 🔬 技术实现原理解析

```text
+----------------------------------------------------------------+
|                        启动脚本运行                             |
|  (启动ZCode.command / node zcode-cdp-launcher.mjs)             |
+-------------------------------+--------------------------------+
                                |
       [1] 更新用户配置          | 扫描 ~/.zcode 开启 supportsImage
                                v
       [2] 内存解析 asar         | 读取 /Applications/ZCode.app/Contents/...
                                | /Resources/app.asar（只读、按需提取对应脚本）
                                v
       [3] 准备内存补丁          | 解除 /plan 附件阻断 + 解除视觉屏蔽
                                | 屏蔽 aKt 登录遮罩 + 注入虚拟 local_user
                                v
       [4] 附加调试启动          | open -a ZCode.app --args --remote-debugging-port=9333
                                v
       [5] 建立 CDP WebSocket   | 监听 Fetch.requestPaused
                                | 匹配 styles-*.js / catalogTree-*.js
                                | -> Fetch.fulfillRequest (回传内存补丁)
                                v
       [6] 页面平滑生效          | Page.reload 重新加载，界面定制即刻就绪
                                v
       [7] 生命周期守护          | 保持常驻，监听窗口关闭 / 进程退出，随应用退出自动销毁
+----------------------------------------------------------------+
```

---

## 📦 附加补丁说明

仓库中包含的 `0001-Fix-version-downgrade-when-re-patching-an-updated-Cl.patch`：
- **背景**：针对 Claude Desktop 中文补丁在官方应用升级后再次执行安装脚本时，因 `--restore-if-backup-exists` 默认选择最早的时间戳备份，导致将刚更新的客户端覆盖回撤为旧版本的缺陷（Issue #156）。
- **修复方案**：引入基于签名和数字版本号比较（`version_key` / `bundle_version`）的选择算法，遇官方有效签名则原地打补丁，备份还原严格挑选最高版本，防止客户端版本意外倒退。

---

## ⚠️ 免责声明

本项目仅供个人本地开发环境优化与技术研究测试使用。项目中所有代码及方案均未侵入修改官方安装包实体。请使用者遵守相关软件的使用许可协议。
