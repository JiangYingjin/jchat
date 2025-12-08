# ======================================================
# 第一阶段：构建阶段 (使用Node.js官方镜像进行构建)
# ======================================================
FROM node:24-slim AS builder

# 启用 Corepack 以使用 package.json 中指定的包管理器版本
RUN corepack enable

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 yarn.lock 并安装依赖
COPY package.json yarn.lock ./
RUN yarn

# 复制所有项目文件
COPY . .

# 如果你的构建需要 NVM 的特定设置，通常在 Docker 中不需要，
# 因为我们直接使用容器镜像提供的 Node 版本。

# 构建 Next.js 生产环境代码
# Next.js 的 standalone 模式会自动把需要的 node_modules 复制到 .next/standalone
RUN yarn build

# ======================================================
# 第二阶段：运行阶段 (使用更小的基础镜像，如 Alpine 或 Distroless)
# 职责：运行应用，并以非root用户运行
# ======================================================
FROM node:24-slim

# 1. 使用非 root 用户
USER node

# 2. 设置工作目录
WORKDIR /app

# 3. 复制运行时所需文件
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next

# 6. 暴露服务端口
EXPOSE 3000

# 7. 定义启动命令
# Next.js standalone 模式的启动命令通常是 node server.js
# 这里我们使用 PM2 作为进程管理器（如果需要）。
# ！！！注意：在 Docker 中，通常不推荐使用 PM2，
# 而是使用容器编排工具（如 Kubernetes）或 Docker 的 restart 策略来管理进程。
# 如果非用 PM2 不可，需要额外的配置。
#
# 推荐使用直接启动：
CMD ["node", "server.js"]
