#!/usr/bin/env node

/**
 * ZCode CDP 零侵入内存增强启动器
 * -----------------------------------------
 * 功能特性：
 * 1. 【屏蔽登录】：彻底屏蔽启动时的全屏登录/欢迎弹窗，无论是未登录还是退出登录，永不弹窗阻断；
 * 2. 【虚拟用户】：注入本地虚拟就绪用户，使客户端内部鉴权状态始终保持正常就绪；
 * 3. 【直达模型设置】：启动后默认直接展开并跳转至“模型服务商设置（Model Provider）”界面；
 * 4. 【隐藏左下角信息】：通过注入 CSS 隐藏侧边栏左下角的用户头像与昵称（只保留设置齿轮图标）；
 * 5. 【解除多模态限制】：解除 /plan 附件阻断与 Coding Plan GLM 视觉能力屏蔽；
 * 6. 【零改包、零篡改签名】：100% 纯内存拦截与用户空间配置，不修改 /Applications/ZCode.app 任何文件。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";

const isWin = process.platform === "win32";

// 跨平台解析 ZCode 可执行文件与 app.asar 路径
function resolveAppPaths() {
  const customPath = process.env.ZCODE_PATH;
  if (customPath && fs.existsSync(customPath)) {
    const isDir = fs.statSync(customPath).isDirectory();
    if (isWin) {
      const exe = isDir ? path.join(customPath, "ZCode.exe") : customPath;
      const asar = path.join(path.dirname(exe), "resources", "app.asar");
      return { exe, asar };
    } else {
      const exe = customPath;
      const asar = path.join(customPath, "Contents", "Resources", "app.asar");
      return { exe, asar };
    }
  }

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const candidates = [
      path.join(localAppData, "Programs", "ZCode", "ZCode.exe"),
      path.join(localAppData, "ZCode", "ZCode.exe"),
      path.join(programFiles, "ZCode", "ZCode.exe"),
      path.join(programFilesX86, "ZCode", "ZCode.exe")
    ];

    for (const exe of candidates) {
      if (fs.existsSync(exe)) {
        const asar = path.join(path.dirname(exe), "resources", "app.asar");
        if (fs.existsSync(asar)) {
          return { exe, asar };
        }
      }
    }

    const fallbackExe = candidates[0];
    return { exe: fallbackExe, asar: path.join(path.dirname(fallbackExe), "resources", "app.asar") };
  } else {
    const defaultApp = "/Applications/ZCode.app";
    return {
      exe: defaultApp,
      asar: path.join(defaultApp, "Contents", "Resources", "app.asar")
    };
  }
}

const DEFAULT_PORT = 9333; // 专用调试端口，避开 9222 (Brave/Chrome 等浏览器默认占用)

// 1. 解析命令行参数
const args = process.argv.slice(2);
const port = parseInt(args.find(a => a.startsWith("--port="))?.split("=")[1] || process.env.ZCODE_DEBUG_PORT || DEFAULT_PORT, 10);
const restart = args.includes("--restart") || args.includes("-r");
const help = args.includes("--help") || args.includes("-h");

if (help) {
  console.log(`
用法:
  node zcode-cdp-launcher.mjs [选项]

选项:
  --port=<port>    指定 CDP 远程调试端口 (默认: 9333)
  --restart, -r    如果 ZCode 正在运行，自动平滑重启以附加调试端口
  --help, -h       查看帮助信息
`);
  process.exit(0);
}

// 2. 检查端口与运行状态
async function checkPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isZCodeProcessRunning() {
  try {
    if (isWin) {
      const stdout = execSync('tasklist /FI "IMAGENAME eq ZCode.exe" /NH', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return stdout.toLowerCase().includes("zcode.exe");
    } else {
      const stdout = execSync('pgrep -f "/Applications/ZCode.app/Contents/MacOS/ZCode" || pgrep -f "ZCode Helper" || true', { encoding: "utf8" });
      return stdout.trim().split("\n").filter(Boolean).length > 0;
    }
  } catch {
    return false;
  }
}

function quitZCode() {
  try {
    if (isWin) {
      execSync('taskkill /IM ZCode.exe /F 2>nul || exit 0', { shell: "cmd.exe", stdio: "ignore" });
    } else {
      try {
        execSync('osascript -e \'tell application "ZCode" to quit\' 2>/dev/null || true');
      } catch {}
      for (let i = 0; i < 6; i++) {
        if (!isZCodeProcessRunning()) return true;
        execSync("sleep 0.5");
      }
      try {
        execSync('pkill -f "/Applications/ZCode.app" 2>/dev/null || true');
      } catch {}
    }
  } catch {}
  return true;
}

// 3. 从 app.asar 纯内存提取指定文件（完全不修改原 asar 文件）
function readAsarEntry(pattern) {
  const { asar: ASAR_PATH } = resolveAppPaths();
  if (!fs.existsSync(ASAR_PATH)) {
    throw new Error(`找不到 ZCode app.asar 文件: ${ASAR_PATH}\n(若安装在自定义路径，可通过环境变量 ZCODE_PATH 指定 ZCode.exe 或安装根目录)`);
  }
  const fd = fs.openSync(ASAR_PATH, "r");
  try {
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    const headerSize = headerBuf.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, jsonBuf, 0, headerSize, 16);
    const header = JSON.parse(jsonBuf.toString("utf8"));

    function findFile(obj, pat, curPath = "") {
      if (obj.files) {
        for (const [k, v] of Object.entries(obj.files)) {
          const res = findFile(v, pat, curPath ? `${curPath}/${k}` : k);
          if (res) return res;
        }
      } else if (pat.test(curPath)) {
        return { path: curPath, ...obj };
      }
      return null;
    }

    const entry = findFile(header, pattern);
    if (!entry) {
      throw new Error(`未能从 app.asar 中定位到匹配 ${pattern} 的文件`);
    }

    const dataBuf = Buffer.alloc(entry.size);
    const offset = 16 + headerSize + Number(entry.offset);
    fs.readSync(fd, dataBuf, 0, entry.size, offset);
    return {
      fileName: path.basename(entry.path),
      content: dataBuf.toString("utf8")
    };
  } finally {
    fs.closeSync(fd);
  }
}

// 4. 生成内存补丁代码
function generatePatches() {
  console.log("\n步骤 2/3: 读取前端资源并准备内存热补丁...");

  // A. 补丁 styles-*.js
  const stylesInfo = readAsarEntry(/styles-.*\.js$/);
  let patchedStyles = stylesInfo.content;
  let stylesPatches = 0;

  // 补丁 1：解除 /plan 快捷指令对附件的强行阻断
  if (patchedStyles.includes("`unsupportedPlanShortcut`")) {
    patchedStyles = patchedStyles.replaceAll("`unsupportedPlanShortcut`", "`planShortcut`");
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 解除 /plan 快捷指令附件阻断");
  }

  // 补丁 2：解除 Coding Plan 下针对 GLM-5.3 的视觉屏蔽 (ZR 函数)
  const zrRegex = /function ZR\([^)]*\)\{return\s*t===!0\?![\s\S]*?:!1\}/;
  if (zrRegex.test(patchedStyles)) {
    patchedStyles = patchedStyles.replace(zrRegex, "function ZR(e,t,n){return t===!0}");
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 解除 Coding Plan 视觉能力强制屏蔽 (ZR 函数)");
  }

  // 补丁 3：屏蔽启动强制登录检测守卫 (GJt)
  if (patchedStyles.includes("d=!r||!t&&!l;")) {
    patchedStyles = patchedStyles.replace("d=!r||!t&&!l;", "d=!1;");
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 屏蔽启动账号检测守卫 (GJt d=!1)");
  }

  // 补丁 4：屏蔽根组件渲染全屏登录页面 (aKt)
  const aKtRenderRegex = /:F\?\(0,\$\.jsxs?\)\(k9,\{children:\[V,kt,At,zt,Bt,\(0,\$\.jsx\)\(aKt,\{onComplete:Lt\}\)\]\}\):/;
  if (aKtRenderRegex.test(patchedStyles)) {
    patchedStyles = patchedStyles.replace(aKtRenderRegex, ":!1?(0,$.jsxs)(k9,{children:[V,kt,At,zt,Bt,(0,$.jsx)(aKt,{onComplete:Lt})]}):");
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 彻底切断全屏登录遮罩渲染分支 (:!1?...aKt)");
  }

  // 补丁 5：React 组件级强制隐藏左下角头像与用户名，清空其 children
  const loginTriggerRegex = /"data-testid":ine,"aria-label":x,children:E/;
  if (loginTriggerRegex.test(patchedStyles)) {
    patchedStyles = patchedStyles.replace(loginTriggerRegex, '"data-testid":ine,"aria-label":x,style:{display:`none`},className:`hidden`,children:null');
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: React 渲染层强制隐藏左下角头像与用户名 (children:null)");
  }

  // 补丁 6：彻底移除模型设置页面的【智谱 / BigModel】预置项与订阅卡片
  const presetGroupTarget = "y=(0,Q.useMemo)(()=>[{id:`preset`,title:h.formatMessage({id:`settings.modelProvider.presetTitle`}),items:e.map(({id:e,displayName:n,provider:r})=>{let i=NBt({presetId:e,provider:r,connectionModeItems:v,connectionSelections:s,modelProviders:t});return{key:H5(e),type:`preset`,presetId:e,label:n,provider:r,displayName:n,statusProvider:i,statusActive:i?.executable===!0}})},{id:`custom`,";
  if (patchedStyles.includes(presetGroupTarget)) {
    patchedStyles = patchedStyles.replace(presetGroupTarget, "y=(0,Q.useMemo)(()=>[{id:`custom`,");
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 彻底移除模型设置中的【智谱 / BigModel】分组及订阅卡片");
  }

  // 补丁 7：消除右侧“加载中...”动画，默认直出首个自定义供应商配置
  const origT = "T=p?FBt({selectedNodeKey:p,navigationItemByKey:C,selectableNavigationItems:x,connectionSelections:s,pendingConnectionSelections:c,familyConnectionSettingsLoading:l,familyConnectionSettingsFailed:u,modelProvidersLoading:r}):null";
  const newT = "T=(p?FBt({selectedNodeKey:p,navigationItemByKey:C,selectableNavigationItems:x,connectionSelections:s,pendingConnectionSelections:c,familyConnectionSettingsLoading:l,familyConnectionSettingsFailed:u,modelProvidersLoading:r}):null)??x[0]??null";
  if (patchedStyles.includes(origT)) {
    patchedStyles = patchedStyles.replace(origT, newT);
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 消除右侧【加载中...】占位，直接默认渲染首个模型供应商");
  }

  // 补丁 8：左侧导航栏无延迟直接高亮选中首个自定义供应商
  const origL = "navigationGroups:Be,selectedNodeKey:L,onSelectNavItem:Xe";
  const newL = "navigationGroups:Be,selectedNodeKey:L??Be[0]?.items[0]?.key??null,onSelectNavItem:Xe";
  if (patchedStyles.includes(origL)) {
    patchedStyles = patchedStyles.replace(origL, newL);
    stylesPatches++;
    console.log("  [+] 已就绪内存补丁: 左侧模型列表直接高亮选中首项，零刷新抖动");
  }

  // B. 补丁 catalogTree-*.js（虚拟用户就绪注入）
  const catInfo = readAsarEntry(/catalogTree-.*\.js$/);
  let patchedCat = catInfo.content;
  let catPatches = 0;

  if (patchedCat.includes("user:null")) {
    patchedCat = patchedCat.replace("user:null", 'user:{id:"local_user",username:"",displayName:""}');
    catPatches++;
    console.log("  [+] 已就绪内存补丁: 注入本地匿名虚拟用户状态 (user:{id:\"local_user\"})");
  }

  return {
    styles: { fileName: stylesInfo.fileName, code: patchedStyles, count: stylesPatches },
    catalog: { fileName: catInfo.fileName, code: patchedCat, count: catPatches }
  };
}

// 5. 更新 ~/.zcode 用户目录中的运行时模型配置（用户空间，零侵入 App 原包）
function patchUserRuntimeModelConfigs() {
  const home = os.homedir();

  // A. 更新 ~/.zcode/v2/provider_config.json (GUI 自定义模型属性)
  const providerConfigPath = path.join(home, ".zcode/v2/provider_config.json");
  if (fs.existsSync(providerConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(providerConfigPath, "utf8"));
      const rules = data?.config?.modelConfigRules?.providerModelRules || [];
      let updatedCount = 0;
      for (const r of rules) {
        if (!r.config.properties.inputFormat || !r.config.properties.inputFormat.supportsImage) {
          r.config.properties.inputFormat = {
            supportsText: true,
            supportsImage: true,
            supportsVideo: false,
            supportsAudio: false,
            supportsPdf: true
          };
          updatedCount++;
        }
      }
      if (updatedCount > 0) {
        fs.writeFileSync(providerConfigPath, JSON.stringify(data, null, 2), "utf8");
        console.log(`  [+] 已为 provider_config.json 中 ${updatedCount} 个模型开启 inputFormat.supportsImage`);
      }
    } catch (e) {
      console.warn("  [!] 更新 provider_config.json 异常:", e.message);
    }
  }

  // B. 更新 ~/.zcode/cli/config.json (CLI Agent 端模型能力)
  const cliConfigPath = path.join(home, ".zcode/cli/config.json");
  if (fs.existsSync(cliConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cliConfigPath, "utf8"));
      let updatedCli = 0;
      for (const p of Object.values(data.provider || {})) {
        for (const m of Object.values(p.models || {})) {
          if (!m.attachment || !m.supportsImages) {
            m.attachment = true;
            m.supportsImages = true;
            m.modalities = {
              input: ["text", "image", "pdf"],
              output: ["text"]
            };
            updatedCli++;
          }
        }
      }
      if (updatedCli > 0) {
        fs.writeFileSync(cliConfigPath, JSON.stringify(data, null, 2), "utf8");
        console.log(`  [+] 已为 cli/config.json 中 ${updatedCli} 个模型配置 attachment=true 与 supportsImages=true`);
      }
    } catch (e) {
      console.warn("  [!] 更新 cli/config.json 异常:", e.message);
    }
  }

  // C. 更新 ~/.zcode/v2/runtime/provider/.../zcode-builtin.json
  const runtimeBase = path.join(home, ".zcode/v2/runtime/provider");
  if (fs.existsSync(runtimeBase)) {
    let patchedCount = 0;
    function walkAndPatch(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const fullPath = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walkAndPatch(fullPath);
        } else if (ent.name === "zcode-builtin.json") {
          try {
            let content = fs.readFileSync(fullPath, "utf8");
            let updated = content.replace(/"supportsImage":\s*false/g, '"supportsImage": true');
            if (updated !== content) {
              fs.writeFileSync(fullPath, updated, "utf8");
              patchedCount++;
              console.log(`  [+] 已同步内置模型规则缓存: ${path.relative(home, fullPath)}`);
            }
          } catch (err) {
            console.warn(`  [!] 更新 ${fullPath} 失败:`, err.message);
          }
        }
      }
    }
    walkAndPatch(runtimeBase);
    if (patchedCount > 0) {
      console.log(`  [+] 已成功同步 ${patchedCount} 处内置规则缓存 (supportsImage: true)`);
    }
  }
}

// 6. 获取 CDP Target 列表
async function fetchCdpTargets(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
  });
}

// 7. CDP 注入核心流程
async function injectViaCdp(port, patches) {
  console.log(`\n正在连接 CDP 调试接口 (127.0.0.1:${port})...`);

  let target = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 25000) {
    try {
      const targets = await fetchCdpTargets(port);
      // 匹配 ZCode 主渲染页面
      target = targets.find(t => t.type === "page" && (t.url.includes("index.html") || t.title.includes("ZCode") || t.url.startsWith("file://")));
      if (target && target.webSocketDebuggerUrl) {
        break;
      }
    } catch {
      // 端口就绪中
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!target || !target.webSocketDebuggerUrl) {
    throw new Error(`连接超时: 未能在端口 ${port} 找到 ZCode 的活动主窗口`);
  }

  console.log(`[+] 成功发现 ZCode 渲染目标: ${target.title} (${target.id})`);
  console.log(`[+] 正在建立 WebSocket 调试会话...`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let messageId = 1;
  const pendingRequests = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  console.log("[+] CDP 调试会话已建立");

  // 处理接收到的 CDP 事件与响应
  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    // 命令回调
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
      return;
    }

    // 核心：拦截 styles-*.js 与 catalogTree-*.js
    if (data.method === "Fetch.requestPaused") {
      const { requestId, request } = data.params;
      const url = request.url;

      if (url.includes("styles-") && url.endsWith(".js")) {
        console.log(`  [*] [CDP 拦截] 捕获到前端核心脚本: ${path.basename(url)}`);
        try {
          await send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/javascript; charset=utf-8" }
            ],
            body: Buffer.from(patches.styles.code, "utf8").toString("base64")
          });
          console.log(`  [✨] [CDP 注入成功] 已无损载入多模态+免登录前端核心！`);
        } catch (err) {
          console.error("  [!] 履行 styles 拦截请求失败:", err);
          await send("Fetch.continueRequest", { requestId });
        }
      } else if (url.includes("catalogTree-") && url.endsWith(".js")) {
        console.log(`  [*] [CDP 拦截] 捕获到状态核心脚本: ${path.basename(url)}`);
        try {
          await send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/javascript; charset=utf-8" }
            ],
            body: Buffer.from(patches.catalog.code, "utf8").toString("base64")
          });
          console.log(`  [✨] [CDP 注入成功] 已无损载入本地虚拟就绪用户状态！`);
        } catch (err) {
          console.error("  [!] 履行 catalogTree 拦截请求失败:", err);
          await send("Fetch.continueRequest", { requestId });
        }
      } else {
        await send("Fetch.continueRequest", { requestId });
      }
    }
  };

  // 启用 Fetch 劫持规则
  console.log("[+] 正在配置 CDP Fetch 内存劫持规则...");
  await send("Fetch.enable", {
    patterns: [
      { urlPattern: "*styles-*.js", requestStage: "Request" },
      { urlPattern: "*catalogTree-*.js", requestStage: "Request" }
    ]
  });

  // 注入新文档初加载脚本：隐藏左下角头像昵称 + 默认跳转模型设置
  console.log("[+] 正在注入界面定制脚本（隐藏左下角头像 + 默认直达模型设置）...");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        // 1. 注入 CSS 隐藏左下角头像与昵称 + 智谱预置项
        const hideStyle = document.createElement("style");
        hideStyle.id = "zcode-hide-profile-style";
        hideStyle.textContent = \`
          button[data-testid="login-trigger"],
          [data-testid="login-trigger"],
          [data-node-key*="preset:"],
          div:has(> [data-node-key*="preset:"]),
          div:has(> [data-purpose-section-title="智谱"]),
          aside footer div.flex.min-w-0 > button:first-child {
            display: none !important;
          }
        \`;
        (document.head || document.documentElement).appendChild(hideStyle);

        // 2. 预设直达模型服务商设置的路由意图
        sessionStorage.setItem("zcode-settings-section-intent", "modelProvider");

        // 3. 页面就绪后若没有正在打开的任务，自动平滑展开模型设置
        window.addEventListener("DOMContentLoaded", () => {
          let attempts = 0;
          const timer = setInterval(() => {
            attempts++;
            const settingsBtn = document.querySelector('[data-testid="task-settings-button"]');
            if (settingsBtn) {
              window.dispatchEvent(new CustomEvent("zcode:settings-section-intent", {
                detail: { section: "modelProvider" }
              }));
              settingsBtn.click();
              clearInterval(timer);
            } else if (attempts > 25) {
              clearInterval(timer);
            }
          }, 400);
        });
      })();
    `
  });

  await send("Page.enable");
  await send("Runtime.enable");

  // 启用 Page 和 Runtime
  await send("Page.enable");
  await send("Runtime.enable");

  // 对当前页面进行即时隐藏处理
  try {
    await send("Runtime.evaluate", {
      expression: `(() => {
        const style = document.createElement("style");
        style.id = "zcode-hide-profile-style";
        style.textContent = 'button[data-testid="login-trigger"] { display: none !important; }';
        (document.head || document.documentElement).appendChild(style);
        const btn = document.querySelector('[data-testid="login-trigger"]');
        if (btn) btn.style.setProperty("display", "none", "important");
      })()`
    });
  } catch {}

  // 触发页面重载使内存补丁即刻生效
  console.log("[+] 正在让前端重新加载以加载内存补丁...");
  await send("Page.reload", { ignoreCache: true });

  console.log("\n========================================================");
  console.log("🎉 ZCode 多模态与免登录增强已通过 CDP 内存注入完全生效！");
  console.log("   - 官方应用安装文件 100% 原始未动，签名安全完好");
  console.log("   - 启动登录/欢迎弹窗已彻底屏蔽");
  console.log("   - 左下角用户头像与名字已隐藏（仅保留设置齿轮）");
  console.log("   - /plan 快捷指令已放行图片与多模态输入");
  console.log("   - 默认直接展示模型服务商设置抽屉");
  console.log("========================================================\n");
  console.log("[*] CDP 守护会话持续保持中 (随 ZCode 退出而自动退出)...");

  // 关键：保持连接常驻，直到 ZCode 关闭（双重保底：WebSocket 断开 + 进程存活轮询）
  await new Promise((resolve) => {
    const cleanExit = () => {
      console.log("[*] 检测到 ZCode 窗口已关闭，CDP 守护进程平滑退出。");
      clearInterval(aliveChecker);
      resolve();
      process.exit(0);
    };

    ws.onclose = cleanExit;
    ws.onerror = cleanExit;

    // 心跳保底检查：如果 ZCode 进程已不存在，立即自我销毁，绝不残留
    const aliveChecker = setInterval(() => {
      if (!isZCodeProcessRunning()) {
        cleanExit();
      }
    }, 2000);
  });
}

// 主流程
async function main() {
  console.log("=== ZCode CDP 内存增强启动器 ===\n");

  // 1. 同步修补用户目录模型规则
  console.log("步骤 1/3: 检查并同步用户空间模型规则 (~/.zcode)...");
  patchUserRuntimeModelConfigs();

  // 2. 从 asar 读取并准备内存补丁
  const patches = generatePatches();

  // 3. 检查 ZCode 运行状态
  console.log("\n步骤 3/3: 检查 ZCode 进程与 CDP 调试接口...");
  const isPortOpen = await checkPortOpen(port);
  const isRunning = isZCodeProcessRunning();

  if (isPortOpen) {
    console.log(`  [+] 检测到 ZCode 已在端口 ${port} 开启调试支持，直接进行内存注入！`);
  } else {
    if (isRunning) {
      if (restart) {
        console.log("  [*] 检测到 ZCode 正在运行但未开启调试端口，正在平滑重启以附加 CDP...");
        quitZCode();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log(`  [!] ZCode 当前正在运行，但未开启调试端口 (--remote-debugging-port=${port})。`);
        console.log("      正在自动平滑退出并重新启动以激活调试端口...");
        quitZCode();
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const appPaths = resolveAppPaths();
    console.log(`  [*] 正在启动 ZCode 并附加调试端口 (--remote-debugging-port=${port})...`);
    if (isWin) {
      spawn(appPaths.exe, [`--remote-debugging-port=${port}`], {
        detached: true,
        stdio: "ignore"
      }).unref();
    } else {
      spawn("open", ["-a", appPaths.exe, "--args", `--remote-debugging-port=${port}`], {
        detached: true,
        stdio: "ignore"
      }).unref();
    }
  }

  // 4. 执行注入
  await injectViaCdp(port, patches);
}

main().catch((err) => {
  console.error("\n[!] 执行失败:", err);
  process.exit(1);
});
