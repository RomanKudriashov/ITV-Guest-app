"""
Сторож прогона: тесты не говорят с настоящим Telegram (партия 30).

Локальный `.env` может направлять стек на живого бота — его включают для
ручной проверки. Прогон поверх такого стека слал бы уведомления живым людям
и опрашивал бы боевого бота. Поэтому pytest не стартует, если бэкенд смотрит
в api.telegram.org. Воркер и бот pytest не использует; их проверяет сторож
e2e (`e2e/fixtures/telegramGuard.ts`) — он ходит в контейнеры.
"""

from __future__ import annotations

from urllib.parse import urlparse

HOW_TO_FIX = (
    "Поднимите службы с эмулятором Bot API, не трогая .env:\n"
    "  TELEGRAM_API_URL=http://telegram-emulator:1087 TELEGRAM_BOT_TOKEN=emulator-token \\\n"
    "    docker compose --profile grms up -d backend worker bot\n"
    "После прогона вернуть живого бота: docker compose --profile grms up -d backend worker bot"
)


def points_to_real_telegram(url: str | None) -> bool:
    host = (urlparse(url or "").hostname or "").lower()
    return host == "telegram.org" or host.endswith(".telegram.org")


def refusal(where: str, url: str) -> str:
    return (
        f"ПРОГОН ОСТАНОВЛЕН: {where} смотрит в настоящий Telegram ({url}).\n"
        "Тесты отправили бы сообщения живым людям.\n" + HOW_TO_FIX
    )
