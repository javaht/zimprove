#!/bin/zsh

# 自动定位当前脚本所在目录
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 补充常见 Node 路径（包含 mise、homebrew、nvm 等）
export PATH="$HOME/.local/share/mise/installs/node/22.22.1/bin:$HOME/.local/share/mise/shims:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh 2>/dev/null)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 未能在系统中找到 Node.js 执行程序！"
  echo "请检查 PATH 或安装 Node.js (>= 22.0.0)"
  echo "按任意键退出..."
  read -k 1
  exit 1
fi

echo "=========================================="
echo "   ZCode 免登录 & 多模态增强启动器 (CDP)   "
echo "=========================================="
echo ""

# 后台常驻守护进程（保持 CDP WebSocket 会话直到 ZCode 窗口关闭）
nohup node "$DIR/zcode-cdp-launcher.mjs" --restart > "$DIR/launcher.log" 2>&1 &
PID=$!

echo "[*] 正在启动并建立 CDP 内存热补丁会话 (PID: $PID)..."
sleep 2

if ps -p $PID > /dev/null; then
  echo "✨ 注入完成！ZCode 窗口已在内存中完成热修补："
  echo "   1. 启动登录遮罩已切断"
  echo "   2. 左下角头像与昵称已隐藏"
  echo "   3. 多模态与 /plan 限制已放行"
  echo ""
  echo "（本窗口将在 2 秒后自动退出，也可直接关闭）"
  sleep 2
else
  echo "[!] 启动日志："
  cat "$DIR/launcher.log"
  echo ""
  echo "按任意键退出..."
  read -k 1
fi
