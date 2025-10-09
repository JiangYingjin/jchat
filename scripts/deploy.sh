#!/bin/zsh

# 记录开始时间
START_TIME=$(date +%s)

PROJ_DIR="/root/proj/jchat"
TMP_BUILD_DIR="/tmp/jchat/build"
SERVE_DIR="/www/jchat"
PM2_CONF_PATH="$SERVE_DIR/jchat.json"

# 保存原始的 PM2 配置
PM2_CONF=$(cat "$PM2_CONF_PATH")

# 清理临时构建目录
rm -rf "$TMP_BUILD_DIR"
mkdir -p "$TMP_BUILD_DIR"

echo "📁 复制代码至临时构建目录 ..."

# 复制所有文件到临时目录，排除 .next 和 node_modules
rsync -az --exclude='.next' --exclude='node_modules' "$PROJ_DIR/" "$TMP_BUILD_DIR/"

# 创建 node_modules 软链接以提升效率
if [ -d "$PROJ_DIR/node_modules" ]; then
    ln -sf "$PROJ_DIR/node_modules" "$TMP_BUILD_DIR/node_modules"
fi

# 进入临时构建目录
cd "$TMP_BUILD_DIR" || exit

echo "🔨 在临时目录中开始构建 ..."

# 清理并重新构建
rm -rf .next
source ~/.zshrc
nvm use 22

# 执行构建，如果失败则退出
if ! yarn build; then
    echo "❌ 构建失败，不应用更改"
    exit 1
fi

echo "✅ 构建成功，开始应用更改 ..."

# 同步文件到服务目录
rm -rf "$SERVE_DIR" && mkdir -p "$SERVE_DIR"
rsync -az --delete --force .next/standalone/ public "$SERVE_DIR"
rsync -az --delete --force .next/server .next/static "$SERVE_DIR/.next"

# 恢复 PM2 配置
echo "$PM2_CONF" >"$PM2_CONF_PATH"

# 删除服务目录下的 .env* 文件
echo "🗑️  删除服务目录下的 .env* 文件 ..."
find "$SERVE_DIR" -name ".env*" -type f -delete

# 列出并链接 PROJ_DIR 下的所有 .env* 文件到服务目录
echo "🔗 链接 PROJ_DIR 下的 .env* 文件到服务目录 ..."
for env_file in "$PROJ_DIR"/.env*; do
    if [ -f "$env_file" ]; then
        filename=$(basename "$env_file")
        echo "  📄 链接: $filename"
        ln -sf "$env_file" "$SERVE_DIR/$filename"
    fi
done

# 重启服务
pm2 del jchat || true
pm2 start "$PM2_CONF_PATH"

echo "🎉 部署完成！"

# 计算并显示总耗时
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
MINUTES=$((TOTAL_TIME / 60))
SECONDS=$((TOTAL_TIME % 60))

if [ $MINUTES -gt 0 ]; then
    echo "⏱️  总耗时: ${MINUTES}分${SECONDS}秒"
else
    echo "⏱️  总耗时: ${SECONDS}秒"
fi

# 清理临时构建目录
rm -rf "$TMP_BUILD_DIR"
