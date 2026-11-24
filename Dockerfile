FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json bun.lock* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Guayaquil

COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/supabase ./supabase
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
