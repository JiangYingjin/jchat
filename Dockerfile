# ======================================================
# 第一阶段：构建阶段
# ======================================================
FROM node:24-slim AS builder

# 启用 Corepack 以使用 package.json 中指定的包管理器版本
RUN corepack enable

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 pnpm-lock.yaml 并安装依赖
COPY package.json pnpm-lock.yaml ./
RUN pnpm i

# 复制所有项目文件
COPY . .

RUN pnpm build

# ======================================================
# 第二阶段：运行阶段
# ======================================================
FROM node:24-slim

USER node

WORKDIR /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next

EXPOSE 3000

# 在 Docker 中，通常不推荐使用 PM2
# 而是使用容器编排工具（如 Kubernetes）或 Docker 的 restart 策略来管理进程
# 推荐使用直接启动：
CMD ["node", "server.js"]
