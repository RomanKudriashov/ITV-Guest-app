"""
Элементы управления и их привязка к переменным.

Элемент — то, что видит гость; привязка — то, каким каналом это делается.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel

from apps.grms.services import catalog

from .room_type import RoomType
from .variable import Variable
from .zone import Zone


class ControlElement(TenantModel):
    """
    Элемент каталога, поставленный в тип номера: вид, зона, порядок, заголовок.

    kind — код из catalog.ELEMENTS, не произвольная строка. Вид, иконка, логика
    и способ показа состояния фиксированы каталогом (ТЗ §11).

    Однотипные элементы ставятся повторно (два фанкойла, несколько групп штор)
    и различаются slug'ом: ac.1, ac.2. Отсюда уникальность по slug, а не по kind.
    """

    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="elements")
    zone = models.ForeignKey(
        Zone, on_delete=models.SET_NULL, null=True, blank=True, related_name="elements"
    )

    # Тот самый controlId, который единственным уходит на фронт. Разбирать его
    # строкой на фронте запрещено — это идентификатор, а не признак типа.
    slug = models.SlugField(max_length=64)
    kind = models.CharField(max_length=32, choices=catalog.ELEMENT_CHOICES)

    # Пусто → берётся заголовок вида из каталога.
    title = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)

    # Пусто → иконка зоны, а если и её нет — иконка вида из каталога. Нужна
    # там, где вид один, а элементы разные: у трёх сцен один `kind`, и
    # различить их фронт может только присланным глифом.
    icon = models.CharField(max_length=32, blank=True)

    # Короткая подпись под названием: «всё готово ко сну» у сцены «Ночь».
    #
    # Живёт У ЭЛЕМЕНТА, а не у вида: у четырёх сцен один `kind`, и подпись
    # отличает их друг от друга — ровно как иконка. Придумывать эти слова на
    # фронте нельзя: различить сцены он может только разбором `controlId`, а
    # это ключ, а не признак типа. Пусто — подписи нет, карточка обходится
    # названием.
    hint = TranslatableField()

    class Meta:
        db_table = "grms_control_element"
        ordering = ["sort_order", "slug"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "slug"], name="uniq_grms_element_per_type"
            )
        ]

    def __str__(self) -> str:
        return f"{self.slug} ({self.kind})"

class Binding(TenantModel):
    """
    Маппинг: CAPABILITY элемента ↔ переменная.

    Связь именно с capability, а не «элемент ↔ одна переменная», — по данным,
    а не по вкусу: кондиционер это ОДИН элемент интерфейса, но за ним четыре
    переменные (C_FCU_MainSw, C_FCU_Speed, C_FCU_Setpoint, F_FCU_Temperature).
    Связь «элемент ↔ переменная» такой элемент выразить не может: пришлось бы
    либо резать фанкойл на четыре независимых элемента — и тогда термостат
    собирает фронт, чего он делать не должен, — либо складывать несколько
    переменных в одно поле.

    Зона и порядок стоят на ControlElement: это свойства размещения элемента,
    и на связи с переменной им делать нечего.
    """

    element = models.ForeignKey(
        ControlElement, on_delete=models.CASCADE, related_name="bindings"
    )
    capability = models.CharField(max_length=32, choices=catalog.CAPABILITY_CHOICES)
    variable = models.ForeignKey(Variable, on_delete=models.PROTECT, related_name="bindings")

    # Значение, отправляемое для trigger-capability (сцены). Не зашито
    # константой: на части объектов сцена активируется нулём, а не единицей.
    trigger_value = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "grms_binding"
        ordering = ["capability"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "element", "capability"], name="uniq_grms_binding_per_element"
            ),
            # Одна переменная не используется дважды внутри типа — иначе два
            # элемента управляли бы одним каналом и расходились в состоянии.
            models.UniqueConstraint(
                fields=["hotel", "variable"], name="uniq_grms_variable_used_once"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.element_id}.{self.capability} → {self.variable_id}"
