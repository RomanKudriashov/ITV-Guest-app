FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# libpq для psycopg, зависимости сборки Pillow уже есть в wheel'ах
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements-dev.txt

COPY . .

RUN chmod +x /app/entrypoint.sh

EXPOSE 8000
# Через bash явно: bind-mount ./backend:/app в dev перекрывает права из
# образа, и потерянный +x на хосте иначе роняет контейнер.
ENTRYPOINT ["bash", "/app/entrypoint.sh"]
CMD ["api"]
