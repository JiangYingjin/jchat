#!/bin/bash

echo "--- 构建镜像 ---"
docker build -t jchat:latest -f Dockerfile . || exit 1

echo "--- 部署容器 ---"
docker stop jchat 2>/dev/null
docker rm jchat 2>/dev/null
docker run -d \
    --name jchat \
    --restart unless-stopped \
    -p 8037:3000 \
    --env-file .env \
    --env-file .env.production \
    --cpus=2 \
    --memory=1g \
    jchat:latest || exit 1
