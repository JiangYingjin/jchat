#!/bin/bash

set -e

docker build -t jchat:latest -f Dockerfile . 
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
    jchat:latest
