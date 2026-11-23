# AgileCampus 生产镜像——Next.js 16 standalone 多阶段构建
# 参照 node_modules/next/dist/docs 的 output:"standalone" 指南

# ---- deps：仅装依赖，最大化 layer 缓存 ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder：编译 standalone 产物（含 drizzle-kit 供 migrate 阶段复用）----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build 读 next.config 的 output:"standalone"，产出 .next/standalone
RUN npm run build

# ---- runner：最小运行时，仅搬运 standalone + 静态资源 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# 监听全网卡，供容器外访问；端口可经 PORT 覆盖
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# 非 root 运行
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 自带精简 node_modules 与 server.js；static/public 须手工搬入
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
