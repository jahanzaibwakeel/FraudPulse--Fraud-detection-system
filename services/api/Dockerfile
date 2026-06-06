FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/api/package.json services/api/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/api services/api
RUN npm run build -w @fraudpulse/shared && npm run build -w @fraudpulse/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/api/package.json services/api/package.json
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]
