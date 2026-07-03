# Deterministic build for Railway / Render (both accept a Dockerfile).
# One image runs either process: web (default) or worker (override the command).
FROM node:22-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Keep full node_modules: the Prisma CLI (used by `migrate deploy` on release)
# lives in devDependencies.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
# Web process. The worker service overrides this with: node dist/worker.js
CMD ["node", "dist/server.js"]
