#!/bin/zsh

# --- 配置 ---
PROJ_DIR="/root/proj/jchat"
TMP_BUILD_DIR="/tmp/jchat/build"
SERVE_DIR="/www/jchat"
PM2_CONF_PATH="$SERVE_DIR/jchat.json"
APP_USER="app"
PM2_PROCESS_NAME="jchat"

# 记录开始时间
START_TIME=$(date +%s)

# 1. 保存原始 PM2 配置
if [ -f "$PM2_CONF_PATH" ]; then
    PM2_CONF=$(cat "$PM2_CONF_PATH")
    echo "📖 读取现有 PM2 配置成功"
elif [ -f "$PROJ_DIR/jchat.json" ]; then
    PM2_CONF=$(cat "$PROJ_DIR/jchat.json")
    echo "⚠️ 运行目录无配置，使用开发目录下的 jchat.json"
else
    echo "❌ 找不到 jchat.json 配置文件！"
    exit 1
fi

# 清理临时构建目录
rm -rf "$TMP_BUILD_DIR"
mkdir -p "$TMP_BUILD_DIR"

echo "📁 复制代码至临时构建目录 ..."

# 复制文件
rsync -az --exclude='.git' --exclude='.next' --exclude='node_modules' "$PROJ_DIR/" "$TMP_BUILD_DIR/"

# 进入临时构建目录
cd "$TMP_BUILD_DIR" || exit

echo "🔨 在临时目录中开始构建 ..."

# 清理并重新构建
rm -rf .next
source ~/.zshrc
nvm use 24

# 需要安装非软链接 node_modules 依赖，不能直接使用软链接
# 否则构建之后的 .next/standalone/node_modules 还是软连接，非特权用户会无法访问
pnpm i

# 构建
if ! pnpm build; then
    echo "❌ 构建失败，不应用更改"
    exit 1
fi

echo "✅ 构建成功，开始应用更改 ..."

# 准备服务目录
rm -rf "$SERVE_DIR" && mkdir -p "$SERVE_DIR"

# 复制 Standalone 产物
cp -r .next/standalone/* "$SERVE_DIR/"
cp -r .next "$SERVE_DIR/" # 必须要有 .next/BUILD_ID 等文件，否则无法正常启动
cp -r public "$SERVE_DIR/"

# 恢复 PM2 配置
echo "$PM2_CONF" > "$SERVE_DIR/jchat.json"

# 复制环境变量
echo "📄 复制 .env 文件 ..."
for env_file in "$PROJ_DIR"/.env*; do
    if [ -f "$env_file" ]; then
        cp "$env_file" "$SERVE_DIR/"
    fi
done

# 移交权限
echo "👮 移交权限给 $APP_USER ..."
chown -R $APP_USER:$APP_USER "$SERVE_DIR"

# 重启服务
echo "🔄 重启服务 (用户: $APP_USER) ..."
su - $APP_USER -c ". ~/.zshrc && pm2 start $PM2_CONF_PATH"

echo "🎉 部署完成！"

# 计算耗时
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
echo "⏱️  总耗时: ${TOTAL_TIME}秒"

# 清理临时构建目录
rm -rf "$TMP_BUILD_DIR"