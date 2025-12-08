#!/bin/bash

IMAGE_NAME="jchat"
EXPOSE_PORT=8037
APP_PORT=3000
CONTAINER_NAME="${IMAGE_NAME}"

echo "--- 构建镜像 ---"
docker build -t "$IMAGE_NAME:latest" -f Dockerfile . || exit 1

echo "--- 部署容器 ---"
docker stop "$CONTAINER_NAME" 2>/dev/null
docker rm "$CONTAINER_NAME" 2>/dev/null
docker run -d --restart unless-stopped \
    --name "$CONTAINER_NAME" \
    -p "$EXPOSE_PORT:$APP_PORT" \
    --env-file .env \
    --env-file .env.production \
    --cpus=2 \
    --memory=1g \
    "$IMAGE_NAME:latest" || exit 1
