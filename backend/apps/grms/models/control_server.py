"""
СЕРВЕР УПРАВЛЕНИЯ ОТЕЛЯ (партия 63-3).

Куда коннектор отеля шлёт команды оборудованию: тип сервера, адрес, порт,
протокол, авторизация, таймаут. Задаётся в Control; коннектор принимает адрес
только в пределах разрешённого круга, заданного при установке на объекте
(`connector/itv_connector/remote.py`). Не задан — коннектор работает по своему
локальному файлу, как до 63-3.

ПОДКЛЮЧЕНИЙ У ОТЕЛЯ МОЖЕТ БЫТЬ НЕСКОЛЬКО (партия 65, решение Олега 28.10):
например, демо-номера на эмуляторе и номер 100 на настоящем iRidi объекта.
Подключение = сервер управления + коннектор, через который до него идти.
Номер назначается подключению (`RoomConnection`); без назначения работает
подключение «по умолчанию» — так у отеля с одним подключением ничего не
меняется. Один коннектор ведёт ровно одно подключение: у коннектора один
endpoint `iridi`, и две записи на один коннектор спорили бы за его адрес.

Путь «напрямую из облака» не делаем (решение Олега 23.10).
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class ControlServer(TenantModel):
    class Kind(models.TextChoices):
        IRIDI = "iridi", "iRidi"
        # «Скоро»: в выборе есть, настроить нельзя (Bittel — TCP/MySQL,
        # коннектор пока говорит только HTTP).
        BITTEL = "bittel", "Bittel"
        OTHER = "other", "Другое"

    class Protocol(models.TextChoices):
        HTTP = "http", "HTTP"
        HTTPS = "https", "HTTPS"

    class Auth(models.TextChoices):
        NONE = "none", "Без входа"
        BASIC = "basic", "Логин и пароль"
        TOKEN = "token", "Токен"

    # Имя подключения в Control: «Эмулятор (демо)», «iRidi объекта». Пусто —
    # экран называет подключение по коннектору и адресу.
    name = models.CharField(max_length=120, blank=True)
    # Подключение номеров без своего назначения. Ровно одно на отель.
    is_default = models.BooleanField(default=False)
    node = models.ForeignKey("hotels.OnPremNode", on_delete=models.SET_NULL, null=True, blank=True, related_name="control_servers")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.IRIDI)
    protocol = models.CharField(max_length=8, choices=Protocol.choices, default=Protocol.HTTP)
    host = models.CharField(max_length=255)
    port = models.PositiveIntegerField(default=1085)
    auth = models.CharField(max_length=8, choices=Auth.choices, default=Auth.NONE)
    login = models.CharField(max_length=128, blank=True)
    # Пароль или токен — ЗАШИФРОВАННЫЙ (`apps.grms.vault`). Открытым не хранится.
    secret_sealed = models.TextField(blank=True)
    timeout_ms = models.PositiveIntegerField(default=3000)
    is_enabled = models.BooleanField(default=True)
    # Номер правки: коннектор отвечает, какую принял, — так видно, дошла ли.
    revision = models.PositiveIntegerField(default=1)
    applied_revision = models.PositiveIntegerField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    apply_error = models.CharField(max_length=32, blank=True)
    apply_detail = models.CharField(max_length=255, blank=True)
    last_check_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True, blank=True)
    last_check_detail = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "grms_control_server"
        constraints = [
            models.UniqueConstraint(
                fields=["hotel"],
                condition=models.Q(deleted_at__isnull=True, is_default=True),
                name="uniq_grms_control_server_default",
            ),
            models.UniqueConstraint(
                fields=["hotel", "node"],
                condition=models.Q(deleted_at__isnull=True, node__isnull=False),
                name="uniq_grms_control_server_node",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.host}:{self.port}"

    @property
    def label(self) -> str:
        """Имя для экранов: своё, иначе по коннектору, иначе по адресу."""
        if self.name:
            return self.name
        if self.node_id and self.node:
            return self.node.name
        return f"{self.host}:{self.port}"

    @property
    def base_url(self) -> str:
        return f"{self.protocol}://{self.host}:{self.port}"


class RoomConnection(TenantModel):
    """
    Номер → подключение (партия 65).

    Отдельной таблицей по той же причине, что и `RoomTypeRoom`: hotels не
    начинает зависеть от grms, модуль снимается целиком. Нет записи — номер
    идёт через подключение «по умолчанию».
    """

    room = models.OneToOneField("hotels.Room", on_delete=models.CASCADE, related_name="grms_connection")
    server = models.ForeignKey(ControlServer, on_delete=models.CASCADE, related_name="rooms")

    class Meta:
        db_table = "grms_room_connection"

    def __str__(self) -> str:
        return f"{self.room_id}→{self.server_id}"
