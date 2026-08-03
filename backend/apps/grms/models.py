"""
Схема модуля «Управление номером (GRMS)» — СКЕЛЕТ по контрактам.

Здесь только структура: ни адаптера iRidi, ни коннектора, ни импорта Excel, ни
конструктора, ни гостевого API. Всё это G1–G6. Причина такого порядка проста:
коннектор — отдельный сервис за сетью объекта, и переписать его «по ходу»
нельзя, поэтому сначала документы, потом код.

Контракты:
    docs/grms/contracts/room-type-config.md   — что хранит тип, версии, откат
    docs/grms/contracts/control-elements.md   — каталог и capabilities
    docs/grms/reuse-map.md                    — что берём готовым
Прозвон боевого сервера: docs/grms/iridi-probe.md

Все таблицы — тенантные, все закрыты RLS FORCE (core/0014_rls_grms). Держать
эту конфигурацию в hotel.settings нельзя: она описывает, какая команда уходит
в какое физическое оборудование, и ошибка в скоупе означает управление чужим
номером. JSON-поле не даёт ни ссылочной целостности с Room, ни версий с
откатом, ни строчной изоляции.
"""

from __future__ import annotations

from django.db import models

from apps.core.fields import TranslatableField
from apps.core.models import TenantModel
from apps.grms import catalog


class RoomType(TenantModel):
    """
    Тип номера — номера с одинаковым составом оборудования (ТЗ §10).

    Все номера типа получают ОДИН интерфейс, но обращаются к РАЗНЫМ устройствам
    iRidi. Настраивается тип один раз, а не 200 раз по числу комнат.

    Прозвон это подтверждает: у ТИП2 (708) и ТИП3 (706) наборы тегов
    различаются (2 шторы против 3), а внутри типа одинаковы.
    """

    code = models.SlugField(max_length=64)
    title = TranslatableField()

    # Шаблон имени устройства iRidi. Единственная подстановка — {room},
    # номер комнаты: «Modbus TCP Server (Slave mode) {room}». Выражений и
    # функций в шаблоне нет намеренно — это поле правит администратор объекта.
    #
    # Шаблон ПРЕДЛАГАЕТСЯ системой, но подтверждается администратором (ТЗ §10),
    # а не применяется молча: опечатка здесь означает команды не в тот номер.
    device_name_template = models.CharField(max_length=255, blank=True)

    # На этом объекте всегда пусто. "Custom" из примеров ТЗ и Postman на боевом
    # сервере ЛОМАЕТ чтение: скрипт склеивает тег как subdevice + ":" + feedback
    # и ищет несуществующий «Custom:F_DND» (см. iridi-probe.md §8.1).
    # Поле оставлено на случай другого объекта.
    subdevice = models.CharField(max_length=128, blank=True)

    notes = models.TextField(blank=True)

    class Meta:
        db_table = "grms_room_type"
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "code"], name="uniq_grms_room_type_per_hotel")
        ]

    def __str__(self) -> str:
        return self.code


class RoomTypeRoom(TenantModel):
    """
    Связь «комната ↔ тип номера».

    Отдельной таблицей, а не полем на hotels.Room, сознательно:
      * hotels не начинает зависеть от grms — направление остаётся grms → hotels,
        миграции не переплетаются;
      * появляется естественное место для переопределения имени устройства на
        комнату (ТЗ §10) — оно принадлежит именно связи, а не комнате и не типу;
      * модуль снимается целиком, не оставляя мёртвой колонки в hotels_room.

    Комната относится максимум к одному типу — отсюда OneToOne.
    """

    room = models.OneToOneField(
        "hotels.Room", on_delete=models.CASCADE, related_name="grms_type_link"
    )
    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="rooms")

    # Эталонная комната типа: на ней администратор прогоняет конфигурацию до
    # публикации (ТЗ §11). Единственный момент, когда команда уходит в номер
    # не от гостя.
    is_reference = models.BooleanField(default=False)

    # Полностью заменяет результат шаблона, если задано. Реальные объекты не
    # бывают идеально регулярными: одна комната после переделки может
    # называться иначе, и из-за неё менять шаблон всего типа нельзя.
    device_name_override = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "grms_room_type_room"
        ordering = ["room_id"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "room"], name="uniq_grms_room_link_per_hotel")
        ]

    def __str__(self) -> str:
        return f"{self.room_id} → {self.room_type_id}"


class Zone(TenantModel):
    """
    Зона внутри номера: спальня, гостиная, ванная (ТЗ §11).

    Создаётся при необходимости. В простом номере зона одна и в интерфейсе
    не показывается.
    """

    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="zones")
    code = models.SlugField(max_length=64)
    title = TranslatableField()
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "grms_zone"
        ordering = ["sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "code"], name="uniq_grms_zone_per_type"
            )
        ]

    def __str__(self) -> str:
        return self.code


class Variable(TenantModel):
    """
    Переменная iRidi — строка из Excel. ТЕХНИЧЕСКАЯ КАРТА, а не элемент
    интерфейса (ТЗ §8): Excel не описывает гостевой экран.

    Обязательно допускаются оба вырожденных случая:
      * команда без feedback — сцены (C_Scene_1, тега F_Scene_* на стенде нет);
      * feedback без команды — текущая температура (F_FCU_Temperature 1).
    """

    class ValueKind(models.TextChoices):
        BINARY = catalog.ValueKind.BINARY, "0/1"
        ENUM = catalog.ValueKind.ENUM, "Дискретный набор"
        RANGE = catalog.ValueKind.RANGE, "Диапазон"

    room_type = models.ForeignKey(RoomType, on_delete=models.CASCADE, related_name="variables")
    key = models.SlugField(max_length=64)

    command = models.CharField(max_length=128, blank=True)  # C_*
    feedback = models.CharField(max_length=128, blank=True)  # F_*

    value_kind = models.CharField(
        max_length=16, choices=ValueKind.choices, default=ValueKind.BINARY
    )
    min_value = models.IntegerField(default=0)
    max_value = models.IntegerField(default=1)

    # Диапазон как он был в Excel («0/1», «0-3», «16-32») и исходное описание.
    # Храним сырым, потому что формат полуструктурированный и результат разбора
    # подтверждает администратор (ТЗ §9). Когда разбор ошибётся — а он ошибётся,
    # Excel по ТИП1 уже разошёлся с сервером на две группы света, — спорную
    # строку нужно будет посмотреть глазами.
    raw_range = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "grms_variable"
        ordering = ["key"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "key"], name="uniq_grms_variable_per_type"
            )
        ]

    def __str__(self) -> str:
        return self.command or self.feedback or self.key


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


class RoomPin(TenantModel):
    """
    PIN проживания: подтверждение, что человек с телефоном действительно живёт
    в этом номере.

    Зачем он вообще нужен. QR висит на стене В НОМЕРЕ, и отсканировать его
    может кто угодно, кто в номер зашёл: горничная, сосед, гость предыдущего
    заезда со старым скриншотом. Смотреть на состояние — приемлемо, менять
    климат и открывать шторы — нет.

    Хранится ХЭШ, а не PIN, и хэш МЕДЛЕННЫЙ (тот же механизм, что у паролей).
    Четыре цифры перебираются мгновенно, поэтому утечка таблицы не должна
    означать перебор оффлайн; онлайн-перебор закрывает счётчик попыток.

    Живёт в `grms`, а не полем на `hotels.Room`: направление зависимости
    остаётся grms → hotels, и модуль снимается целиком, не оставляя мёртвой
    колонки в номерном фонде.
    """

    room = models.OneToOneField(
        "hotels.Room", on_delete=models.CASCADE, related_name="grms_pin"
    )
    pin_hash = models.CharField(max_length=256)

    # Конец проживания. Пусто — PIN действует, пока его не сменили: PMS-выезда
    # у нас пока неоткуда узнать, и притворяться, что мы его знаем, нельзя.
    valid_until = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "grms_room_pin"
        ordering = ["room_id"]
        constraints = [
            models.UniqueConstraint(fields=["hotel", "room"], name="uniq_grms_pin_per_room")
        ]

    def __str__(self) -> str:
        return f"pin:{self.room_id}"

    @property
    def is_active(self) -> bool:
        from django.utils import timezone as dj_timezone

        if not self.pin_hash:
            return False
        return self.valid_until is None or self.valid_until > dj_timezone.now()


class PublishedConfig(TenantModel):
    """
    Опубликованная версия конфигурации типа. Гость видит ТОЛЬКО её.

    payload — САМОДОСТАТОЧНЫЙ снимок: зоны, элементы, порядок, маппинг,
    диапазоны, шаблон устройства, имена команд и feedback. Он не ссылается на
    текущие Variable и ControlElement, а содержит их копию.

    Иначе удаление переменной в черновике молча сломало бы работающую
    опубликованную конфигурацию, а откат к v2 означал бы «v2 плюс сегодняшние
    правки справочников» — то есть не откат.

    Откат — публикация копии старой версии НОВЫМ номером, а не удаление новых:
    история не переписывается, иначе «почему в номере перестал работать свет»
    становится неотвечаемым вопросом.
    """

    room_type = models.ForeignKey(
        RoomType, on_delete=models.CASCADE, related_name="published_configs"
    )
    version = models.PositiveIntegerField()
    payload = models.JSONField(default=dict, blank=True)

    is_current = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.UUIDField(null=True, blank=True)

    # Заполняется у версии, созданной откатом, — на какую версию откатывались.
    rolled_back_from = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "grms_published_config"
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["hotel", "room_type", "version"], name="uniq_grms_config_version"
            ),
            # Текущая версия ровно одна на тип.
            models.UniqueConstraint(
                fields=["hotel", "room_type"],
                condition=models.Q(is_current=True),
                name="uniq_grms_current_config_per_type",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.room_type_id} v{self.version}{' *' if self.is_current else ''}"
