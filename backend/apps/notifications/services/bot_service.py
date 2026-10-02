"""
СЛУЖБА БОТА (партия 28): длинный опрос мессенджера, привязка, кнопки.

ОДИН ТОКЕН — ОДИН ОПРАШИВАЮЩИЙ. Telegram не даёт двум серверам читать одного
бота: второй получает 409. Поэтому служба одна на платформу (`bot` в compose),
вебхука нет (нет домена), а 409 — отдельное состояние в пульсе: «бота
опрашивает другой сервер», а не безликая ошибка.

СЛУЖБА НЕ ПАДАЕТ ПО КРУГУ. Нет токена — спит и пишет пульс «токен не задан»;
токен не принят — пишет «токен не принят» и ждёт с растущей паузой; сеть
моргнула — то же. Перезапуск контейнера ничего бы не починил, а только засорил
бы журнал и спрятал причину.

КРУГ = ОДИН ВЫЗОВ `tick()`. Тесты зовут его напрямую и не ждут времени: пауза
возвращается числом, а спит вызывающий (`run_bot`).

ТОКЕН В ЖУРНАЛЕ — ТОЛЬКО ХВОСТОМ (последние четыре символа).
"""

from __future__ import annotations

import logging

from django.db import close_old_connections
from django.utils import timezone

from apps.notifications.messengers import Incoming, Messenger, MessengerError
from apps.notifications.messengers.texts import say
from apps.notifications.models import MessengerBotState

logger = logging.getLogger("apps.notifications.bot")

PAUSE_MIN = 5
PAUSE_MAX = 600
# Без токена проверять чаще незачем: он появится только с перезапуском.
IDLE_SLEEP = 300

Status = MessengerBotState.Status


class BotService:
    def __init__(self, messenger: Messenger, *, poll_timeout: int = 25):
        self.bot = messenger
        self.poll_timeout = poll_timeout
        self.username = ""
        self.pause = 0

    # --- Пульс --------------------------------------------------------------------

    # Пульс — платформенная таблица без RLS: обычное подключение.
    def _state(self) -> MessengerBotState:
        state, _ = MessengerBotState.objects.get_or_create(messenger=self.bot.code)
        return state

    def _save(self, **changes) -> MessengerBotState:
        state = self._state()
        for field, value in changes.items():
            setattr(state, field, value)
        state.save()
        return state

    def _fail(self, status: str, detail: str) -> int:
        """Состояние отказа, запись в журнал и следующая пауза — вдвое длиннее."""
        self.pause = min(PAUSE_MAX, self.pause * 2 if self.pause else PAUSE_MIN)
        now = timezone.now()
        self._save(
            status=status,
            token_tail=self.bot.token_tail(),
            last_error=detail[:500],
            last_error_at=now,
            # Опрос был — неудачный. «Последний опрос» отвечает на «жива ли
            # служба», а «жив ли бот» — состояние.
            last_poll_at=now,
        )
        logger.warning("Бот %s: %s; следующая попытка через %s с", self.bot.code, detail, self.pause)
        return self.pause

    # --- Круг -------------------------------------------------------------------------

    def tick(self) -> int:
        """Один круг. Возвращает, сколько секунд подождать до следующего."""
        close_old_connections()
        if not self.bot.configured():
            self._save(status=Status.NO_TOKEN, token_tail="", username="", last_poll_at=timezone.now())
            if self.pause != IDLE_SLEEP:
                logger.info("Бот %s: токен не задан — служба спит", self.bot.code)
            self.pause = IDLE_SLEEP
            return IDLE_SLEEP

        if not self.username:
            try:
                self.username = self.bot.me()
            except MessengerError as exc:
                if exc.unauthorized:
                    return self._fail(Status.REJECTED, f"токен не принят ({self.bot.token_tail()})")
                return self._fail(Status.ERROR, exc.detail)
            logger.info("Бот %s: @%s, токен %s", self.bot.code, self.username, self.bot.token_tail())
            self._save(
                username=self.username,
                token_tail=self.bot.token_tail(),
                started_at=timezone.now(),
            )

        state = self._state()
        try:
            updates = self.bot.updates(state.update_offset, self.poll_timeout)
        except MessengerError as exc:
            if exc.unauthorized:
                self.username = ""
                return self._fail(Status.REJECTED, f"токен не принят ({self.bot.token_tail()})")
            if exc.conflict:
                return self._fail(Status.CONFLICT, exc.detail)
            return self._fail(Status.ERROR, exc.detail)

        offset = state.update_offset
        for incoming in updates:
            try:
                self.handle(incoming)
            except Exception:  # noqa: BLE001 — одно сообщение не вправе остановить бота
                logger.exception("Бот %s: обновление %s не обработано", self.bot.code, incoming.update_id)
            offset = max(offset, incoming.update_id + 1)
            # Сдвиг — после каждого: упавшая на середине пачка не повторит сделанное.
            self._save(update_offset=offset)

        self.pause = 0
        self._save(status=Status.OK, username=self.username, token_tail=self.bot.token_tail(), last_poll_at=timezone.now())
        return 0

    # --- Входящее ---------------------------------------------------------------------

    def handle(self, incoming: Incoming) -> str:
        from apps.notifications.services import bot_actions, personal

        if incoming.kind == "callback":
            return bot_actions.handle_press(self.bot, incoming)
        if incoming.kind != "message":
            return "skipped"

        # Написал боту — значит, не заблокировал: отметка «бот заблокирован» снимается.
        personal.unblock_chat(incoming.sender_id)
        text = (incoming.text or "").strip()
        command, _, argument = text.partition(" ")
        command = command.split("@")[0].lower()
        if command == "/start" and argument.strip():
            return self._bind(incoming, argument.strip())
        if command in ("/stop", "/unlink"):
            return self._unbind(incoming)
        return self._help(incoming)

    def _reply(self, incoming: Incoming, text: str) -> None:
        try:
            self.bot.send(incoming.chat_id, "", text, [])
        except MessengerError as exc:
            logger.warning("Бот %s: ответ не ушёл: %s", self.bot.code, exc.detail)

    def _bind(self, incoming: Incoming, code: str) -> str:
        from apps.accounts.services import contacts
        from apps.core.fields import translate

        language = incoming.language
        if incoming.chat_type != "private":
            self._reply(incoming, say("group_only_private", language))
            return "group"
        try:
            user = contacts.redeem_code(
                self.bot.code, code, external_id=incoming.sender_id, username=incoming.username
            )
        except contacts.BindingRejected as rejected:
            self._reply(incoming, say(f"bind_{rejected.reason}", language))
            return rejected.reason

        language = user.language or language
        hotel = user.hotel
        hotel_name = translate(hotel.name, language) or hotel.subdomain
        self._reply(
            incoming,
            say("linked", language, name=user.full_name or user.email, hotel=hotel_name)
            + "\n"
            + say("linked_hint", language),
        )
        return "linked"

    def _who(self, users, language: str) -> str:
        from apps.core.fields import translate

        return "; ".join(
            f"{user.full_name or user.email}, {translate(user.hotel.name, language) or user.hotel.subdomain}"
            for user in users
        )

    def _unbind(self, incoming: Incoming) -> str:
        from apps.accounts.services import contacts

        users = contacts.unlink_chat(self.bot.code, incoming.sender_id)
        language = (users[0].language if users else "") or incoming.language
        if not users:
            self._reply(incoming, say("not_bound", language))
            return "not_bound"
        self._reply(incoming, say("unlinked", language, list=self._who(users, language)))
        return "unlinked"

    def _help(self, incoming: Incoming) -> str:
        from apps.accounts.services import contacts

        users = contacts.bound_users(self.bot.code, incoming.sender_id)
        language = (users[0].language if users else "") or incoming.language
        if users:
            self._reply(incoming, say("help_bound", language, list=self._who(users, language)))
        else:
            self._reply(incoming, say("help_unbound", language))
        return "help"
