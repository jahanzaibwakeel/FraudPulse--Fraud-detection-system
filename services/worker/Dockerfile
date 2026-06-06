FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/worker/package.json services/worker/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/worker services/worker
RUN npm run build -w @fraudpulse/shared && npm run build -w @fraudpulse/worker

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/services/worker/dist services/worker/dist
COPY --from=build /app/services/worker/package.json services/worker/package.json
EXPOSE 4100
CMD ["node", "services/worker/dist/index.js"]
