FROM node:20-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
CMD ["node", "dist/tapp/chat.js"]
