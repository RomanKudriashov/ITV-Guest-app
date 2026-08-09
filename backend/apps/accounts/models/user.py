"""
Кто и на каком основании работает с системой.

Три принципиально разных субъекта:
  * персонал отеля  — User + JWT (stateless);
  * гость           — GuestSession + непрозрачный токен с уровнем доверия;
  * платформа       — User с hotel=NULL, отдельный скоуп.

Уровень доверия гостя (trust) — не украшение, а то, от чего зависят права:
отсканировал QR в номере → можно смотреть меню и заказывать; подтверждён по
PMS → можно писать на счёт номера; и т.д. Проверки прав опираются на trust,
а не на «есть ли токен».
"""

from __future__ import annotations


from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin
from django.db import models

from apps.core.managers import AllObjectsManager, BaseManager
from apps.core.models import BaseModel



class UserManager(BaseManager):
    def create_user(self, email: str, password: str | None = None, **extra):
        if not email:
            raise ValueError("Нужен email")
        user = self.model(email=self.normalize_email(email), **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra):
        extra.setdefault("is_platform_admin", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_staff_member", True)
        extra.setdefault("hotel", None)
        return self.create_user(email, password, **extra)

    @staticmethod
    def normalize_email(email: str) -> str:
        return email.strip().lower()


class User(AbstractBaseUser, PermissionsMixin, BaseModel):
    """
    Сотрудник отеля либо платформенный администратор.

    hotel = NULL означает платформенный уровень. Такие строки не видны роли
    приложения из-за RLS — платформенный вход идёт через connection
    платформенной роли (.using("platform")).
    """

    hotel = models.ForeignKey(
        "hotels.Hotel",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="users",
    )
    email = models.EmailField(max_length=254, unique=True)
    full_name = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    language = models.CharField(max_length=8, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff_member = models.BooleanField(default=True, help_text="Сотрудник отеля")
    is_hotel_admin = models.BooleanField(default=False, help_text="Админ отеля")
    is_platform_admin = models.BooleanField(default=False, help_text="Супер-админ платформы")

    # --- Роль в команде платформы (значима только при is_platform_admin) ---
    # Уровень доступа к /admin. Отдельно от ролей внутри отеля: там роль
    # определяется назначением на сервис (R3), здесь — самим пользователем,
    # потому что платформенный админ ни к какому отелю не привязан.
    class PlatformRole(models.TextChoices):
        OWNER = "owner", "Владелец"
        SUPPORT = "support", "Поддержка"
        READ_ONLY = "read_only", "Только чтение"

    platform_role = models.CharField(
        max_length=16, choices=PlatformRole.choices, default=PlatformRole.OWNER
    )

    # --- Усиленный вход (2FA). /admin — мастер-ключ ко всем отелям ---
    # Секрет хранится, пока 2FA не подтверждена кодом: между «показали QR» и
    # «ввели код» пользователь должен успеть завести его в приложении.
    totp_secret = models.CharField(max_length=64, blank=True)
    totp_enabled = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()
    all_objects = AllObjectsManager()

    class Meta:
        db_table = "accounts_user"
        ordering = ["email"]

    def __str__(self) -> str:
        return self.email

    @property
    def is_staff(self) -> bool:
        # Совместимость с django.contrib.auth — своей админки у нас нет.
        return self.is_platform_admin
