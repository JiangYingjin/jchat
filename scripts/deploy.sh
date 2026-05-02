#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# --- 可配置项（允许通过环境变量覆盖） ---
TMP_BUILD_DIR="${TMP_BUILD_DIR:-/tmp/jchat/build}"
SERVE_DIR="${SERVE_DIR:-/www/jchat}"
PM2_PROCESS_NAME="${PM2_PROCESS_NAME:-jchat}"
PM2_CONF_PATH="${PM2_CONF_PATH:-$SERVE_DIR/jchat.json}"
# .env* 部署方式：link（默认）= 硬链优先、失败则软链到 PROJECT_ROOT；copy = 仍复制文件（跨盘或无需单源时用）
JCHAT_DEPLOY_ENV_MODE="${JCHAT_DEPLOY_ENV_MODE:-link}"

START_TIME="$(date +%s)"

die() {
  echo "❌ $*" >&2
  exit 1
}

ensure_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  # 仅支持最常见的 .env 形式：KEY=VALUE / export KEY=VALUE
  # - 忽略空行与注释行
  # - 允许 VALUE 为空
  while IFS= read -r line || [ -n "$line" ]; do
    # 去掉首尾空白
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
    esac

    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
    fi

    # 只处理 KEY=VALUE
    if [[ "$line" != *"="* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local val="${line#*=}"

    # KEY 必须是合法的 shell 变量名
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    # 去掉最外层的单/双引号（常见写法）
    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    export "$key=$val"
  done <"$env_file"
}

# 将 PROJECT_ROOT 下的 .env* 接到 SERVE_DIR，与源码目录共用一份文件（改 ~/proj/jchat/.env 即生效于部署目录）。
link_project_env_into_serve_dir() {
  local pattern dest abs_src
  shopt -s nullglob
  for pattern in "$PROJECT_ROOT"/.env*; do
    [ -f "$pattern" ] || continue
    dest="$SERVE_DIR/$(basename "$pattern")"
    abs_src="$(cd "$(dirname "$pattern")" && pwd)/$(basename "$pattern")"
    if ln "$abs_src" "$dest" 2>/dev/null; then
      echo "   🔗 硬链接: $(basename "$pattern")"
    elif ln -sf "$abs_src" "$dest"; then
      echo "   🔗 软链接: $(basename "$pattern") -> $abs_src"
    else
      die "无法链接环境文件：$abs_src -> $dest"
    fi
  done
  shopt -u nullglob
}

ensure_cmd rsync
ensure_cmd node
ensure_cmd corepack
ensure_cmd pm2

echo "📦 准备临时构建目录：$TMP_BUILD_DIR"
rm -rf "$TMP_BUILD_DIR"
mkdir -p "$TMP_BUILD_DIR"

echo "📁 复制代码到临时构建目录（排除 .git/.next/node_modules）"
rsync -az \
  --exclude='.git' \
  --exclude='.next' \
  --exclude='node_modules' \
  "$PROJECT_ROOT/" "$TMP_BUILD_DIR/"

cd "$TMP_BUILD_DIR" || die "无法进入临时构建目录：$TMP_BUILD_DIR"

echo "🔨 安装依赖并构建（pnpm）"
corepack enable >/dev/null 2>&1 || true
# 临时构建目录无 .git，避免 husky 在 prepare 阶段报错/中断
export HUSKY=0
pnpm i
pnpm build

[ -d ".next/standalone" ] || die "构建产物不存在：.next/standalone（请检查 next.config.ts 是否 output=standalone）"

echo "🚚 应用产物到服务目录：$SERVE_DIR"
rm -rf "$SERVE_DIR"
mkdir -p "$SERVE_DIR"

cp -r .next/standalone/* "$SERVE_DIR/"
cp -r .next "$SERVE_DIR/"
cp -r public "$SERVE_DIR/"

echo "📄 环境文件（.env*）→ 服务目录：${JCHAT_DEPLOY_ENV_MODE}"
if [ "$JCHAT_DEPLOY_ENV_MODE" = "copy" ]; then
  for env_file in "$PROJECT_ROOT"/.env*; do
    if [ -f "$env_file" ]; then
      cp "$env_file" "$SERVE_DIR/"
      echo "   📋 已复制: $(basename "$env_file")"
    fi
  done
else
  link_project_env_into_serve_dir
fi

echo "🧩 准备 PM2 配置：$PM2_CONF_PATH"
if [ -f "$PROJECT_ROOT/jchat.json" ]; then
  cp "$PROJECT_ROOT/jchat.json" "$PM2_CONF_PATH"
elif [ -f "$PROJECT_ROOT/jchat.json.example" ]; then
  echo "⚠️  未找到 jchat.json，已使用 jchat.json.example；生产环境请复制示例为 jchat.json 并按机子修改 cwd/PORT 等"
  cp "$PROJECT_ROOT/jchat.json.example" "$PM2_CONF_PATH"
else
  die "未找到 PM2 配置：$PROJECT_ROOT/jchat.json 或 jchat.json.example"
fi

echo "🔄 重启服务（pm2）"
cd "$SERVE_DIR" || die "无法进入服务目录：$SERVE_DIR"

# 将 .env/.env.production 注入到 pm2 进程环境（pm2 会捕获当前环境）
load_env_file "$SERVE_DIR/.env"
load_env_file "$SERVE_DIR/.env.production"

pm2 delete "$PM2_PROCESS_NAME" >/dev/null 2>&1 || true
pm2 start "$PM2_CONF_PATH" --update-env

END_TIME="$(date +%s)"
TOTAL_TIME="$((END_TIME - START_TIME))"
echo "🎉 部署完成！⏱️ 总耗时: ${TOTAL_TIME}秒"

echo "🧹 清理临时构建目录"
rm -rf "$TMP_BUILD_DIR"
