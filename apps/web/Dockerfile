FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:14000
ARG NEXT_PUBLIC_WS_URL=http://localhost:14000
ARG NEXT_PUBLIC_API_TOKEN=local-admin-token
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_TOKEN=$NEXT_PUBLIC_API_TOKEN
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @fraudpulse/shared && npm run build -w @fraudpulse/web

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
