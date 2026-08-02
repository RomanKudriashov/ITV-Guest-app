# Коннектор ставится на ЧУЖОЙ сервер (NaviBoard на объекте) и обновляется
# редко. Отсюда два требования к образу: маленький и без лишних зависимостей —
# всё, кроме websockets, взято из stdlib.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY itv_connector ./itv_connector

# Непривилегированный пользователь: у процесса нет причин быть root'ом на
# сервере отеля, а доступ ему нужен только исходящий.
RUN useradd --system --no-create-home itv
USER itv

ENV ITV_CONNECTOR_CONFIG=/etc/itv-connector/config.json

# Перезапуск отдаём оркестратору (restart: unless-stopped / systemd Restart=always):
# узел обязан подниматься сам после перезагрузки сервера, без выезда инженера.
ENTRYPOINT ["python", "-m", "itv_connector"]
