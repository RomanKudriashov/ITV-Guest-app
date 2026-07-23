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
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
