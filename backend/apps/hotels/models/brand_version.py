"""
ЧЕРНОВИКИ И ВЕРСИИ ОФОРМЛЕНИЯ.

До этой партии у оформления не было ни того, ни другого: одна строка токенов,
«Сохранить» писал прямо в витрину. Черновик жил В БРАУЗЕРЕ оператора — закрыл
вкладку, и работы нет; двое правили — выигрывал тот, кто сохранил вторым и
молча.

ОДНА ТАБЛИЦА НА ЧЕРНОВИКИ И ПУБЛИКАЦИИ, а не две. И то и другое — СНИМОК
токенов с автором и временем; разница ровно в одном: опубликованный снимок
видит гость. Две таблицы означали бы два набора полей, два сериализатора и
неизбежный день, когда откат восстановит «почти те» токены.
"""

from __future__ import annotations

from django.db import models

from apps.core.models import TenantModel


class BrandVersion(TenantModel):
    """Снимок оформления: черновик оператора или опубликованная версия."""

    class Kind(models.TextChoices):
        DRAFT = "draft", "Черновик"
        PUBLISHED = "published", "Опубликована"

    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.DRAFT)

    # ЧЕРНОВИКОВ НЕСКОЛЬКО, И У КАЖДОГО ИМЯ. Оператор готовит к Новому году,
    # к открытию террасы и «просто попробовать» — без имени через неделю он не
    # отличит их ни по чему, кроме даты, а дата не говорит о замысле.
    name = models.CharField(max_length=120, blank=True, default="")

    # Номер — только у опубликованных. Сквозной по отелю, человеку его называть
    # проще, чем идентификатор: «вернули к версии 7».
    number = models.PositiveIntegerField(null=True, blank=True)

    tokens = models.JSONField(default=dict, blank=True)

    # АВТОР ХРАНИТСЯ ДВАЖДЫ, И ЭТО НЕ ИЗБЫТОЧНОСТЬ. Ссылка нужна, пока человек
    # работает; имя — когда он уволился и запись о нём убрали. История
    # оформления переживает сотрудника, и строка «кто вернул версию 7» без
    # имени превращается в «кто-то».
    author = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="brand_versions",
    )
    author_name = models.CharField(max_length=180, blank=True, default="")

    # От какой ОПУБЛИКОВАННОЙ версии черновик начат. По ней и только по ней
    # видно, что пока оператор правил, витрину опубликовал кто-то другой:
    # публиковать такой черновик вслепую значит стереть чужую работу молча.
    base_version = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafts_from",
    )

    # Публикация является ОТКАТОМ к этой версии.
    #
    # Откат — не обычная публикация, и выглядеть он обязан иначе: «вернули к
    # версии 7», а не «опубликовано». Без этой ссылки история показывала бы
    # ровный ряд публикаций, в котором непонятно, почему оформление вдруг стало
    # прежним.
    restored_from = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="restores",
    )

    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hotels_brand_version"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["hotel", "kind", "-created_at"]),
        ]

    def __str__(self) -> str:
        if self.kind == self.Kind.PUBLISHED:
            return f"Версия {self.number}"
        return self.name or "Черновик"

    @property
    def is_stale(self) -> bool:
        """
        Черновик начат от версии, которая больше не опубликована.

        Считается по данным, а не хранится флагом: флаг пришлось бы обновлять на
        каждой чужой публикации во всех черновиках сразу — и он разошёлся бы с
        правдой в первый же раз, когда обновление не дошло.
        """
        if self.kind != self.Kind.DRAFT:
            return False
        current = (
            BrandVersion.objects.filter(kind=self.Kind.PUBLISHED)
            .order_by("-number")
            .values_list("pk", flat=True)
            .first()
        )
        if current is None:
            return False
        return self.base_version_id != current
