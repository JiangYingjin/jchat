#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

docker stop jchat 2>/dev/null
docker rm jchat 2>/dev/null
docker run -d \
    --name jchat \
    --restart unless-stopped \
    -p 8037:3000 \
    --add-host=host:host-gateway \
    --env-file "$PROJECT_ROOT/.env" \
    --env-file "$PROJECT_ROOT/.env.production" \
    --cpus=2 \
    --memory=1g \
    jchat:latest