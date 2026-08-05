"""
Демо-конфигурация управления номером: тип, переменные, элементы, публикация.

Идемпотентна: гоняется повторно поверх себя и не плодит дублей. Это не
удобство, а условие работы — команда вызывается из общего сида демо-отеля,
который на стенде запускают многократно.

Что засевается и почему именно это:

  * пять групп света ПО ЗОНАМ ПЛАНА (гостиная, спальня, прихожая, гардеробная,
    ванная) — коды зон совпадают с docs/design/grms-concept/plan-geometry.json,
    чтобы G5b смог разложить их по плану, не переименовывая;
  * фанкойл ОДНИМ элементом на четыре переменные — а не четырьмя элементами;
  * две шторы разными элементами: основная и блэкаут;
  * сцены, DND и «Убрать номер» из каталога;
  * мастер-выключатель НЕ ПРИВЯЗАН намеренно (см. ниже);
  * план-двойник: рендер через медиапайплайн и геометрия из замеров
    docs/design/grms-concept/plan-geometry.json — координаты копируются как
    есть, потому что замерены по стенам кадра.

Чего здесь нет и не будет: диммирования, цветовой температуры, процентов
открытия шторы, режимов «охлаждение/нагрев», влажности, AQI и CO₂. Не потому
что «не успели», а потому что таких переменных у ПНР нет (прозвон §6.3, §8.4).
Нарисовать их значило бы показать гостю ручку, которая никуда не подключена.
"""

from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.core.context import tenant_context
from apps.grms import builder, publishing
from apps.grms.models import (
    Binding,
    ControlElement,
    PublishedConfig,
    RoomType,
    RoomTypeRoom,
    Variable,
    Zone,
)
from apps.hotels.models import Hotel, HotelModule, Room

TYPE_CODE = "demo-suite"
DEMO_ROOM = "305"
DEMO_PIN = "4821"

DEVICE_TEMPLATE = "Modbus TCP Server (Slave mode) {room}"

# Зоны — коды РОВНО как в plan-geometry.json. `room` — общая для того, что не
# принадлежит ни одной комнате: сцены, «не беспокоить», «убрать номер».
# (код, заголовок, порядок, глиф). Глиф зоны уезжает гостю в снимке: отличить
# спальню от гардеробной фронт мог бы только разбором кода зоны, а код
# произволен на каждом объекте.
ZONES = [
    ("room", {"ru": "Весь номер", "en": "Whole room", "ar": "الغرفة بالكامل", "zh": "整间客房"}, 0, ""),
    ("living", {"ru": "Гостиная", "en": "Living room", "ar": "غرفة المعيشة", "zh": "客厅"}, 1, "sofa"),
    ("bedroom", {"ru": "Спальня", "en": "Bedroom", "ar": "غرفة النوم", "zh": "卧室"}, 2, "bed"),
    ("entry", {"ru": "Прихожая", "en": "Entrance", "ar": "المدخل", "zh": "玄关"}, 3, "door"),
    ("wardrobe", {"ru": "Гардеробная", "en": "Wardrobe", "ar": "غرفة الملابس", "zh": "衣帽间"}, 4, "wardrobe"),
    ("bathroom", {"ru": "Ванная", "en": "Bathroom", "ar": "الحمام", "zh": "浴室"}, 5, "bath"),
]

BINARY = Variable.ValueKind.BINARY
ENUM = Variable.ValueKind.ENUM
RANGE = Variable.ValueKind.RANGE

# Имена каналов — РОВНО те, что отдаёт железо (и повторяет эмулятор), включая
# пробел перед номером: «C_Light 1», а не «C_Light_1».
VARIABLES = [
    ("light_living", "C_Light 1", "F_Light 1", BINARY, 0, 1, "0/1"),
    ("light_bedroom", "C_Light 2", "F_Light 2", BINARY, 0, 1, "0/1"),
    ("light_entry", "C_Light 3", "F_Light 3", BINARY, 0, 1, "0/1"),
    ("light_wardrobe", "C_Light 4", "F_Light 4", BINARY, 0, 1, "0/1"),
    ("light_bathroom", "C_Light 5", "F_Light 5", BINARY, 0, 1, "0/1"),
    # Шторы бинарные: 0-Curtain Close, 1-Curtain Open. Процента открытия у
    # этих приводов нет.
    ("curtain_main", "C_Curtain 1", "F_Curtain 1", BINARY, 0, 1, "0/1"),
    ("curtain_blackout", "C_Curtain 2", "F_Curtain 2", BINARY, 0, 1, "0/1"),
    ("fcu_power", "C_FCU_MainSw 1", "F_FCU_MainSw 1", BINARY, 0, 1, "0/1"),
    # 0 — АВТО, а не «выключено». Выключение фанкойла — это toggle.
    ("fcu_speed", "C_FCU_Speed 1", "F_FCU_Speed 1", ENUM, 0, 3, "0-3"),
    ("fcu_setpoint", "C_FCU_Setpoint 1", "F_FCU_Setpoint 1", RANGE, 16, 32, "16-32"),
    # Команды нет — только чтение. Вырожденный случай, который схема обязана
    # допускать.
    ("fcu_temp", "", "F_FCU_Temperature 1", RANGE, 0, 50, ""),
    ("dnd", "C_DND", "F_DND", BINARY, 0, 1, "0/1"),
    ("mur", "C_MUR", "F_MUR", BINARY, 0, 1, "0/1"),
    # У сцен feedback'а НЕТ — подтверждено прозвоном (§8.3): F_Scene_* не
    # существует. Второй вырожденный случай.
    ("scene_night", "C_Scene_1", "", BINARY, 0, 1, "0/1"),
    ("scene_morning", "C_Scene_2", "", BINARY, 0, 1, "0/1"),
    ("scene_movie", "C_Scene_3", "", BINARY, 0, 1, "0/1"),
    ("scene_read", "C_Scene_4", "", BINARY, 0, 1, "0/1"),
]

# (slug, kind, zone, sort, заголовок, [(capability, variable, trigger_value)], глиф).
# Глиф пуст — берётся иконка зоны, а если и её нет — иконка вида из каталога.
# Сценам он обязателен: вид у всех трёх один, и различить их фронт может
# только тем, что прислал сервер, — разбирать controlId ему запрещено.
ELEMENTS = [
    ("light.living", "light_group", "living", 10,
     {"ru": "Свет в гостиной", "en": "Living room light", "ar": "إضاءة غرفة المعيشة", "zh": "客厅灯光"},
     [("toggle", "light_living", None)]),
    ("light.bedroom", "light_group", "bedroom", 10,
     {"ru": "Свет в спальне", "en": "Bedroom light", "ar": "إضاءة غرفة النوم", "zh": "卧室灯光"},
     [("toggle", "light_bedroom", None)]),
    ("light.entry", "light_group", "entry", 10,
     {"ru": "Свет в прихожей", "en": "Entrance light", "ar": "إضاءة المدخل", "zh": "玄关灯光"},
     [("toggle", "light_entry", None)]),
    ("light.wardrobe", "light_group", "wardrobe", 10,
     {"ru": "Свет в гардеробной", "en": "Wardrobe light", "ar": "إضاءة غرفة الملابس", "zh": "衣帽间灯光"},
     [("toggle", "light_wardrobe", None)]),
    ("light.bathroom", "light_group", "bathroom", 10,
     {"ru": "Свет в ванной", "en": "Bathroom light", "ar": "إضاءة الحمام", "zh": "浴室灯光"},
     [("toggle", "light_bathroom", None)]),
    ("curtain.main", "curtain", "living", 20,
     {"ru": "Шторы", "en": "Curtains", "ar": "الستائر", "zh": "窗帘"},
     [("toggle", "curtain_main", None)]),
    ("curtain.blackout", "curtain_blackout", "bedroom", 21,
     {"ru": "Блэкаут", "en": "Blackout curtains", "ar": "ستائر التعتيم", "zh": "遮光窗帘"},
     [("toggle", "curtain_blackout", None)]),
    # ОДИН элемент на четыре переменные. Резать фанкойл на четыре независимых
    # нельзя: тогда термостат собирал бы фронт, чего он делать не должен.
    ("ac.1", "air_conditioner", "bedroom", 30,
     # «Кондиционер», а не «Климат»: «Климат» — это раздел, и строка внутри
     # него повторяла собственный заголовок панели.
     {"ru": "Кондиционер", "en": "Air conditioner", "ar": "مكيّف الهواء", "zh": "空调"},
     [("toggle", "fcu_power", None), ("fan_speed", "fcu_speed", None),
      ("setpoint", "fcu_setpoint", None), ("current_temp", "fcu_temp", None)]),
    ("dnd", "dnd", "room", 1,
     {"ru": "Не беспокоить", "en": "Do not disturb", "ar": "الرجاء عدم الإزعاج", "zh": "请勿打扰"},
     [("toggle", "dnd", None)]),
    ("mur", "mur", "room", 2,
     {"ru": "Убрать номер", "en": "Make up room", "ar": "تنظيف الغرفة", "zh": "打扫房间"},
     [("toggle", "mur", None)]),
    ("scene.night", "scene", "room", 40,
     {"ru": "Ночь", "en": "Night", "ar": "ليل", "zh": "夜间"},
     [("trigger", "scene_night", 1)], "moon"),
    ("scene.morning", "scene", "room", 41,
     {"ru": "Утро", "en": "Morning", "ar": "صباح", "zh": "早晨"},
     [("trigger", "scene_morning", 1)], "sunrise"),
    ("scene.movie", "scene", "room", 42,
     {"ru": "Кино", "en": "Movie", "ar": "فيلم", "zh": "观影"},
     [("trigger", "scene_movie", 1)], "movie"),
    # Четвёртая сцена из макета. Канал у неё есть (профиль демо-номера в
    # эмуляторе), feedback'а — как и у остальных — нет.
    ("scene.read", "scene", "room", 43,
     {"ru": "Чтение", "en": "Reading", "ar": "قراءة", "zh": "阅读"},
     [("trigger", "scene_read", 1)], "book"),
    # НАМЕРЕННО БЕЗ ПРИВЯЗКИ. Мастер-выключатель на этом объекте реализуется
    # сценой, отдельного канала (F_MasterSw) у ПНР нет. Элемент стоит в типе,
    # но в опубликованный снимок не попадает и гостю не показывается: кнопка,
    # за которой нет оборудования, — обещание, которое некому исполнить.
    # Заодно это живая проверка правила «непривязанный элемент скрыт всегда».
    ("master.off", "master_switch", "room", 50,
     {"ru": "Выключить всё", "en": "All off", "ar": "إطفاء الكل", "zh": "全部关闭"},
     []),
]

# --- План-двойник ----------------------------------------------------------
#
# Рендер и замеры лежат в docs/ и попадают в приложение НЕ оттуда: картинка
# идёт через медиапайплайн (MinIO + нарезка вариантов), геометрия — в конфиг
# типа. docs остаётся источником, а не хранилищем ассетов.
CONCEPT_DIR = Path(settings.BASE_DIR).parent / "docs" / "design" / "grms-concept"
GEOMETRY_FILE = CONCEPT_DIR / "plan-geometry.json"
RENDER_FILE = CONCEPT_DIR / "render-type1.png"
# Ночной кадр ПОСЧИТАН из светлого (bake_dark_plate.py), поэтому совмещён с ним
# по построению. Нарисованный отдельно render-type1-dark.png не годится:
# габариты комнаты расходятся примерно на 21%, мебель двоится на границе зоны.
RENDER_OFF_FILE = CONCEPT_DIR / "render-type1-off.png"

# Код зоны из plan-geometry.json → элемент, которым управляет тап по комнате.
# Связь ЯВНАЯ, а не «первый светильник в зоне»: догадка на фронте или на
# сервере однажды выберет не тот элемент, и объяснить это гостю будет нечем.
PLAN_ZONE_LIGHTS = {
    "living": "light.living",
    "bedroom": "light.bedroom",
    "entry": "light.entry",
    "wardrobe": "light.wardrobe",
    "bathroom": "light.bathroom",
}

# Код окна → (основная штора, блэкаут). Какой привод обслуживает какое окно —
# свойство ОБЪЕКТА, а не догадка: у ПНР два канала штор на весь номер, и Excel
# не говорит, где именно висит каждый.
#
# Оба привода — на ВСЕХ окнах. Так это и работает: одна команда закрывает
# затемнение по всему номеру, а не в одной комнате, и плита обязана показывать
# то же самое. Блэкаут на одном окне из трёх был домыслом разметки, из-за
# которого гость видел, как «закрылось» только одно окно.
PLAN_WINDOW_CURTAINS = {
    "win-living-top": ("curtain.main", "curtain.blackout"),
    "win-living-side": ("curtain.main", "curtain.blackout"),
    "win-bed-top": ("curtain.main", "curtain.blackout"),
}

# Точка выхода воздуха: густота потока = скорость вентилятора этого элемента.
PLAN_AC_CONTROL = "ac.1"

# Описания кадров. Гостю они не показываются — кадр на плите декоративен, —
# но в медиатеке администратор обязан отличать светлый от ночного.
PLAN_ALT = {
    "ru": "План демо-люкса, свет включён",
    "en": "Demo suite floor plan, lights on",
    "ar": "مخطط الجناح التجريبي، الإضاءة مشغّلة",
    "zh": "演示套房平面图，灯光开启",
}
PLAN_OFF_ALT = {
    "ru": "План демо-люкса, свет выключен",
    "en": "Demo suite floor plan, lights off",
    "ar": "مخطط الجناح التجريبي، الإضاءة مطفأة",
    "zh": "演示套房平面图，灯光关闭",
}


class Command(BaseCommand):
    help = "Засеять демо-конфигурацию управления номером (идемпотентно)"

    def add_arguments(self, parser):
        parser.add_argument("--subdomain", default="crystal")
        parser.add_argument(
            "--demo-entry",
            action="store_true",
            help=(
                "Включить вход без PIN. ВРЕМЕННОЕ ПОСЛАБЛЕНИЕ MVP: включается "
                "только демо-отелю и только осознанно."
            ),
        )

    def handle(self, *args, **options):
        hotel = Hotel.objects.filter(subdomain=options["subdomain"]).first()
        if hotel is None:
            self.stderr.write(f"Отеля «{options['subdomain']}» нет — сеять некуда")
            return

        self._enable_module(hotel, demo_entry=options["demo_entry"])
        with tenant_context(hotel):
            room_type = self._room_type()
            self._zones(room_type)
            self._variables(room_type)
            self._elements(hotel, room_type)
            self._plan(room_type)
            linked = self._link_room(room_type)
        self._pin(hotel, linked)
        version = self._publish(hotel)

        self.stdout.write(
            self.style.SUCCESS(
                f"GRMS демо готов: отель {hotel.subdomain}, тип «{TYPE_CODE}», "
                f"номер {DEMO_ROOM}, опубликована версия {version}"
            )
        )

    # --- Шаги ------------------------------------------------------------

    def _enable_module(self, hotel, *, demo_entry: bool) -> None:
        """
        Тариф `standard` идёт с пустым списком модулей, а менять демо-отелю
        тариф ради одного модуля значит попутно выдать ему всё остальное из
        `business`. Поэтому точечный override — он ровно для этого и заведён.
        """
        with tenant_context(hotel):
            module, _ = HotelModule.objects.get_or_create(
                code=HotelModule.Code.ROOM_CONTROL,
                defaults={"is_enabled": True, "source": HotelModule.Source.OVERRIDE},
            )
            config = dict(module.config or {})
            if demo_entry:
                config["guest_entry_demo"] = True
            module.is_enabled = True
            module.source = HotelModule.Source.OVERRIDE
            module.config = config
            module.save(update_fields=["is_enabled", "source", "config", "updated_at"])

    def _room_type(self) -> RoomType:
        room_type, _ = RoomType.objects.get_or_create(
            code=TYPE_CODE,
            defaults={
                "title": {"ru": "Демо-люкс", "en": "Demo suite", "ar": "جناح تجريبي", "zh": "演示套房"},
                "device_name_template": DEVICE_TEMPLATE,
                # На этом объекте subdevice ВСЕГДА пуст: непустой ломает
                # адресацию тега (прозвон §8.1).
                "subdevice": "",
            },
        )
        if room_type.device_name_template != DEVICE_TEMPLATE:
            room_type.device_name_template = DEVICE_TEMPLATE
            room_type.save(update_fields=["device_name_template", "updated_at"])
        return room_type

    def _zones(self, room_type: RoomType) -> None:
        for code, title, order, icon in ZONES:
            Zone.objects.update_or_create(
                room_type=room_type,
                code=code,
                defaults={"title": title, "sort_order": order, "icon": icon},
            )

    def _variables(self, room_type: RoomType) -> None:
        for key, command, feedback, kind, low, high, raw in VARIABLES:
            Variable.objects.update_or_create(
                room_type=room_type,
                key=key,
                defaults={
                    "command": command,
                    "feedback": feedback,
                    "value_kind": kind,
                    "min_value": low,
                    "max_value": high,
                    "raw_range": raw,
                },
            )

    def _elements(self, hotel, room_type: RoomType) -> None:
        for entry in ELEMENTS:
            slug, kind, zone_code, order, title, bindings = entry[:6]
            icon = entry[6] if len(entry) > 6 else ""
            zone = Zone.objects.filter(room_type=room_type, code=zone_code).first()
            element, _ = ControlElement.objects.update_or_create(
                room_type=room_type,
                slug=slug,
                defaults={
                    "kind": kind,
                    "zone": zone,
                    "title": title,
                    "sort_order": order,
                    "icon": icon,
                },
            )
            # Привязки чистим перед пересозданием: переменная не может
            # использоваться дважды, и повторный прогон с изменённым маппингом
            # иначе упёрся бы в собственный уникальный индекс.
            wanted = {capability for capability, _key, _trigger in bindings}
            Binding.objects.filter(element=element).exclude(capability__in=wanted).delete()
            for capability, variable_key, trigger in bindings:
                builder.bind(
                    hotel,
                    room_type_code=TYPE_CODE,
                    element_slug=slug,
                    capability=capability,
                    variable_key=variable_key,
                    trigger_value=trigger,
                )

    def _plan(self, room_type: RoomType) -> None:
        """
        План-двойник демо-типа: ассет рендера + геометрия из замеров.

        Координаты НЕ пересчитываются и не подгоняются: они замерены по стенам
        рендера, и «поправить на глаз» здесь означает развести разметку с
        картинкой на глазах у гостя. Файл замеров — единственный источник.

        Ни файла, ни картинки — тип остаётся БЕЗ плана, и это не авария: экран
        обязан работать списком контролов. Демо-данные не должны быть причиной,
        по которой не поднимается стенд.
        """
        geometry = self._geometry()
        if geometry is None:
            return
        asset_id = self._plan_asset(RENDER_FILE, PLAN_ALT)
        if not asset_id:
            return
        # Ночного кадра может не быть — тогда плита работает затемняющей маской.
        asset_off_id = self._plan_asset(RENDER_OFF_FILE, PLAN_OFF_ALT)

        zones = [
            {
                "code": zone["code"],
                "controlId": PLAN_ZONE_LIGHTS[zone["code"]],
                "hit": zone["hit"],
                "mask": zone["mask"],
            }
            for zone in geometry.get("zones", [])
            if zone.get("code") in PLAN_ZONE_LIGHTS
        ]
        windows = []
        for window in geometry.get("windows", []):
            curtain, blackout = PLAN_WINDOW_CURTAINS.get(window.get("code"), ("", ""))
            if not curtain:
                continue
            windows.append(
                {
                    "code": window["code"],
                    "x": window["x"],
                    "y": window["y"],
                    "w": window["w"],
                    "h": window["h"],
                    "orientation": window.get("orientation") or "horizontal",
                    "curtainId": curtain,
                    "blackoutId": blackout,
                }
            )
        ac = geometry.get("ac") or {}
        points = (
            [{"controlId": PLAN_AC_CONTROL, "x": ac["x"], "y": ac["y"]}]
            if "x" in ac and "y" in ac
            else []
        )

        plan = {
            "asset_id": asset_id,
            "asset_off_id": asset_off_id,
            "aspect": geometry.get("aspect"),
            "zones": zones,
            "windows": windows,
            "points": points,
        }
        if room_type.plan != plan:
            room_type.plan = plan
            room_type.save(update_fields=["plan", "updated_at"])

    def _geometry(self) -> dict | None:
        if not GEOMETRY_FILE.exists():
            self.stderr.write(f"Замеров плана нет ({GEOMETRY_FILE}) — тип остаётся без плана")
            return None
        try:
            return json.loads(GEOMETRY_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            self.stderr.write(f"Замеры плана не читаются: {exc}")
            return None

    def _plan_asset(self, path: Path, alt: dict) -> str:
        """
        Рендер через ТОТ ЖЕ медиапайплайн, что и загрузка из CMS: MinIO, потом
        Celery режет варианты. Отдельного пути для демо-картинки нет — он бы и
        тестировался отдельно.

        Идемпотентность по имени файла и виду: повторный сид не грузит второй
        экземпляр в полтора мегабайта и не двигает asset_id, из-за которого
        пришлось бы публиковать новую версию конфигурации на ровном месте.
        """
        from apps.media.models import MediaAsset
        from apps.media.services import upload_asset

        existing = (
            MediaAsset.objects.filter(
                kind=MediaAsset.Kind.ROOM_PLAN, original_filename=path.name
            )
            .exclude(status=MediaAsset.Status.FAILED)
            .order_by("-created_at")
            .first()
        )
        if existing is not None:
            return str(existing.pk)

        if not path.exists():
            self.stderr.write(f"Кадра плана нет ({path}) — тип остаётся без него")
            return ""

        asset = upload_asset(
            content=path.read_bytes(),
            filename=path.name,
            kind=MediaAsset.Kind.ROOM_PLAN,
            content_type="image/png",
            alt=alt,
        )
        return str(asset.pk)

    def _link_room(self, room_type: RoomType) -> Room | None:
        room = Room.objects.filter(number=DEMO_ROOM).first()
        if room is None:
            self.stderr.write(f"Номера {DEMO_ROOM} нет — связь не создана")
            return None
        RoomTypeRoom.objects.update_or_create(
            room=room,
            defaults={"room_type": room_type, "is_reference": True},
        )
        return room

    def _pin(self, hotel, room) -> None:
        """PIN проживания демо-номера. Тот же, что показывает ресепшен в демо."""
        if room is None:
            return
        from apps.grms import pin as room_pin
        from apps.grms.models import RoomPin

        with tenant_context(hotel):
            exists = RoomPin.objects.filter(room=room).exists()
        if not exists:
            # Не перезаписываем существующий: повторный сид не должен сбрасывать
            # подтверждения у устройств, которые уже вошли.
            room_pin.set_pin(hotel, room, pin=DEMO_PIN)

    def _publish(self, hotel) -> int:
        """
        Публикуем, только если снимок реально изменился.

        Иначе каждый прогон сида плодил бы версию, и история публикаций —
        единственный ответ на вопрос «почему в номере перестал работать свет» —
        превратилась бы в шум.
        """
        snapshot = publishing.build_snapshot(hotel, TYPE_CODE)
        with tenant_context(hotel):
            current = PublishedConfig.objects.filter(
                room_type__code=TYPE_CODE, is_current=True
            ).first()
            if current is not None and current.payload == snapshot:
                return current.version
        return publishing.publish(hotel, TYPE_CODE).version
