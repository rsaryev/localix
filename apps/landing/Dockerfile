# Static build served by nginx. Build from the repo root:
#   docker build -f apps/landing/Dockerfile -t localix-landing .
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/landing && bun run build

FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752
COPY --from=build /repo/apps/landing/dist /usr/share/nginx/html
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
