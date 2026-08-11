# Прод-образ фронта: собираем статику и отдаём её nginx'ом, который же служит
# реверс-прокси. Контекст сборки — корень репозитория (нужен и frontend/, и
# infra/nginx/). См. docker-compose.prod.yml.

FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Прод-сборка Vite: типы + бандл в /app/dist.
RUN npm run build

FROM nginx:1.27-alpine
# Своя конфигурация вместо дефолтной.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/app.locations.conf /etc/nginx/conf.d/app.locations.conf
# Шаблоны TLS едут в образ, но НЕ в conf.d: их кладёт на место скрипт выпуска
# сертификата. Так образ одинаков и до, и после включения TLS.
COPY infra/nginx/tls.enabled.conf.template /etc/nginx/templates-tls/
COPY infra/nginx/redirect-to-https.conf.template /etc/nginx/templates-tls/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
