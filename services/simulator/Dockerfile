FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/simulator/package.json services/simulator/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/simulator services/simulator
RUN npm run build -w @fraudpulse/shared && npm run build -w @fraudpulse/simulator

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/services/simulator/dist services/simulator/dist
COPY --from=build /app/services/simulator/package.json services/simulator/package.json
CMD ["node", "services/simulator/dist/index.js"]
