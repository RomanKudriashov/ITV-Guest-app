# Прод-образ фронта: собираем статику и отдаём её nginx'ом, который же служит
# реверс-прокси. Контекст сборки — корень репозитория (нужен и frontend/, и
# infra/nginx/). См. docker-compose.prod.yml.

FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Базовый домен — В СБОРКУ. Фронт по нему делит адреса на корень платформы и
# адрес отеля (`src/app/hostRole.ts`), и переменная та же самая `APP_DOMAIN`,
# что задаёт домен бэкенду: две переменные разъехались бы молча.
ARG APP_DOMAIN=""
ENV VITE_APP_DOMAIN=$APP_DOMAIN
# Прод-сборка Vite: типы + бандл в /app/dist.
#
# `build:image`, а не `build`: полная цель гоняет ещё и сторожа кодов событий,
# а он читает `backend/apps` — исходники бэкенда, которых в этом образе нет и
# быть не должно. Сторож честно падал с ENOENT, и прод-образ перестал
# собираться вовсе; обнаружилось это только на выкатке, потому что локально
# `npm run build` бежит из корня репозитория, где бэкенд на месте.
#
# Заглушить сторожа «если каталога нет — пропустить» было бы хуже: он молчал
# бы ровно там, где его нельзя проверить. Здесь честно сказано, что образ этой
# проверки не делает, а сама она осталась в `npm run build` — то есть у
# разработчика и в CI, там, где новые коды событий и появляются.
RUN npm run build:image

FROM nginx:1.27-alpine
# Своя конфигурация вместо дефолтной.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/app.locations.conf /etc/nginx/app.locations.conf
# Шаблоны TLS едут в образ, но НЕ в conf.d: их кладёт на место скрипт выпуска
# сертификата. Так образ одинаков и до, и после включения TLS.
COPY infra/nginx/tls.enabled.conf.template /etc/nginx/templates-tls/
COPY infra/nginx/redirect-to-https.conf.template /etc/nginx/templates-tls/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
