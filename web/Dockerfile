FROM node:24-slim AS build

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /web

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_NEON_AUTH_URL
ENV VITE_API_URL=/api/v1 \
    VITE_NEON_AUTH_URL=${VITE_NEON_AUTH_URL}
RUN pnpm build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 80
