"""
СПРАВОЧНИК СОБЫТИЙ УВЕДОМЛЕНИЙ.

До этого справочника у каждого места, откуда что-то уходило человеку, были
свои тексты и своя адресация: эскалация держала шаблон по умолчанию у себя,
чат и отзывы — строки прямо в обработчике события, оформление — словарь в
модуле рассылки. Все тексты были только русскими, и ни одно место не знало
про остальные.

ЗАВОДИМ МЫ, ОТЕЛЬ НЕ СОЗДАЁТ. Поэтому справочник — это код, а не таблица:
событие появляется вместе с кодом, который его порождает, и без этого кода
не имеет смысла. Отель настраивает событие (включено, кому, каким каналом,
своим текстом) — но не заводит новых.

ЗДЕСЬ ТОЛЬКО ТЕ СОБЫТИЯ, КОТОРЫЕ СИСТЕМА ПОРОЖДАЕТ СЕГОДНЯ. Новое событие
добавляется в справочник одним изменением с кодом, который его рождает:
строка без источника выглядела бы настраиваемой и не приходила бы никогда.

Подстановки — `{{имя}}`, ровно как в шаблонах каналов: текст правит отель, и
исполнять его как код нельзя. Незаполненная подстановка становится прочерком,
а не ломает сообщение — главное (что случилось) текст несёт и без неё.
"""

from __future__ import annotations

import dataclasses
import re

from apps.notifications.channels.base import RenderedMessage

LANGUAGES = ("ru", "en", "ar", "zh")
FALLBACK_LANGUAGE = "ru"

# Кому событие уходит по умолчанию.
AUDIENCE_POINT = "point"  # все каналы отдела
AUDIENCE_LEAD = "lead"  # личные каналы старших смены отдела
AUDIENCE_MANAGER = "manager"  # личные каналы руководителей отдела
# ОБЩИЕ каналы отеля: без отдела И без сотрудника. Личный канал — не общий:
# прежняя рассылка брала «всё без отдела» и доставала каждого, у кого есть
# личный канал, — на стенде это были все семь получателей событий оформления.
AUDIENCE_HOTEL = "hotel"
AUDIENCES = (AUDIENCE_POINT, AUDIENCE_LEAD, AUDIENCE_MANAGER, AUDIENCE_HOTEL)

_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


@dataclasses.dataclass(frozen=True, slots=True)
class EventSpec:
    code: str
    # Как событие называется на экране настроек — не текст сообщения.
    title: dict[str, str]
    subject: dict[str, str]
    body: dict[str, str]
    audience: str
    # Что событие приносит в текст. Подстановка вне этого списка — ошибка
    # справочника, и её ловит проверка, а не получатель.
    placeholders: tuple[str, ...]
    # Пустое поле → готовое слово на языке получателя: {"comment": "no_comment"}.
    # Слово, а не строка, потому что язык известен только при сборке текста.
    defaults: tuple[tuple[str, str], ...] = ()

    def text(self, field: str, language: str, default_language: str) -> str:
        """Текст на языке получателя; нет перевода — язык отеля; нет и его — русский."""
        values = getattr(self, field)
        for candidate in (language, default_language, FALLBACK_LANGUAGE):
            if candidate and values.get(candidate):
                return values[candidate]
        return ""


# Слова, которые подставляются в текст готовыми и тоже зависят от языка.
WORDS: dict[str, dict[str, str]] = {
    "room": {"ru": "Номер {n}", "en": "Room {n}", "ar": "الغرفة {n}", "zh": "{n} 号房"},
    "no_comment": {
        "ru": "Без комментария",
        "en": "No comment",
        "ar": "بدون تعليق",
        "zh": "无评论",
    },
}


def word(key: str, language: str, default_language: str = FALLBACK_LANGUAGE, **values) -> str:
    table = WORDS[key]
    for candidate in (language, default_language, FALLBACK_LANGUAGE):
        if candidate in table:
            return table[candidate].format(**values)
    return ""


EVENTS: dict[str, EventSpec] = {
    spec.code: spec
    for spec in (
        EventSpec(
            code="order.overdue",
            title={
                "ru": "Заявка ждёт ответа",
                "en": "Request awaiting response",
                "ar": "طلب بانتظار الرد",
                "zh": "请求待响应",
            },
            subject={
                "ru": "Заявка №{{number}} — {{point}}",
                "en": "Request #{{number}} — {{point}}",
                "ar": "الطلب رقم {{number}} — {{point}}",
                "zh": "请求 #{{number}} — {{point}}",
            },
            body={
                "ru": "{{room}}\n{{summary}}\n{{comment}}",
                "en": "{{room}}\n{{summary}}\n{{comment}}",
                "ar": "{{room}}\n{{summary}}\n{{comment}}",
                "zh": "{{room}}\n{{summary}}\n{{comment}}",
            },
            # Эскалация адресует по ступеням своего правила; «отдел» — это
            # адресат её первой ступени и значение по умолчанию.
            audience=AUDIENCE_POINT,
            placeholders=(
                "number", "room", "point", "summary", "comment", "status", "total", "step", "delay",
            ),
        ),
        EventSpec(
            code="chat.guest_message",
            title={
                "ru": "Сообщение гостя",
                "en": "Guest message",
                "ar": "رسالة من الضيف",
                "zh": "客人消息",
            },
            subject={
                "ru": "Сообщение из номера {{room_number}}",
                "en": "Message from room {{room_number}}",
                "ar": "رسالة من الغرفة {{room_number}}",
                "zh": "来自 {{room_number}} 号房的消息",
            },
            body={"ru": "{{preview}}", "en": "{{preview}}", "ar": "{{preview}}", "zh": "{{preview}}"},
            audience=AUDIENCE_POINT,
            placeholders=("room_number", "preview"),
        ),
        EventSpec(
            code="review.low",
            title={
                "ru": "Низкая оценка",
                "en": "Low rating",
                "ar": "تقييم منخفض",
                "zh": "低评分",
            },
            subject={
                "ru": "Низкая оценка ({{rating}}/5) · заявка №{{number}}",
                "en": "Low rating ({{rating}}/5) · request #{{number}}",
                "ar": "تقييم منخفض ({{rating}}/5) · الطلب رقم {{number}}",
                "zh": "低评分（{{rating}}/5）· 请求 #{{number}}",
            },
            body={"ru": "{{comment}}", "en": "{{comment}}", "ar": "{{comment}}", "zh": "{{comment}}"},
            # Service recovery — дело руководителя, а не всей смены.
            audience=AUDIENCE_MANAGER,
            placeholders=("rating", "number", "comment", "room_number"),
            defaults=(("comment", "no_comment"),),
        ),
        EventSpec(
            code="brand.published_on_schedule",
            title={
                "ru": "Оформление опубликовано по расписанию",
                "en": "Branding published on schedule",
                "ar": "نُشرت الهوية البصرية في موعدها",
                "zh": "品牌外观已按计划发布",
            },
            subject={
                "ru": "Оформление опубликовано",
                "en": "Branding published",
                "ar": "نُشرت الهوية البصرية",
                "zh": "品牌外观已发布",
            },
            body={
                "ru": "Назначенная публикация состоялась: версия {{version}}.",
                "en": "The scheduled publication took place: version {{version}}.",
                "ar": "تم النشر المجدول: الإصدار {{version}}.",
                "zh": "计划发布已完成：版本 {{version}}。",
            },
            audience=AUDIENCE_HOTEL,
            placeholders=("version", "draft_name", "delay_seconds"),
        ),
        EventSpec(
            code="brand.published_late",
            title={
                "ru": "Оформление опубликовано с опозданием",
                "en": "Branding published late",
                "ar": "نُشرت الهوية البصرية متأخرة",
                "zh": "品牌外观延迟发布",
            },
            subject={
                "ru": "Оформление опубликовано с задержкой",
                "en": "Branding published with a delay",
                "ar": "نُشرت الهوية البصرية بتأخير",
                "zh": "品牌外观延迟发布",
            },
            body={
                "ru": "Назначенная публикация состоялась позже срока на {{delay_seconds}} с: версия {{version}}.",
                "en": "The scheduled publication took place {{delay_seconds}} s late: version {{version}}.",
                "ar": "تم النشر المجدول متأخرًا بمقدار {{delay_seconds}} ث: الإصدار {{version}}.",
                "zh": "计划发布晚了 {{delay_seconds}} 秒完成：版本 {{version}}。",
            },
            audience=AUDIENCE_HOTEL,
            placeholders=("version", "draft_name", "delay_seconds"),
        ),
        EventSpec(
            code="brand.schedule_failed",
            title={
                "ru": "Назначенная публикация оформления не состоялась",
                "en": "Scheduled branding publication failed",
                "ar": "لم يتم النشر المجدول للهوية البصرية",
                "zh": "计划的品牌外观发布未完成",
            },
            subject={
                "ru": "Публикация оформления не состоялась",
                "en": "Branding publication did not happen",
                "ar": "لم يتم نشر الهوية البصرية",
                "zh": "品牌外观未能发布",
            },
            body={
                "ru": (
                    "Черновик «{{draft_name}}» не опубликован: за время ожидания оформление "
                    "изменил кто-то другой. Черновик сохранён — откройте его и решите, что делать."
                ),
                "en": (
                    "Draft “{{draft_name}}” was not published: someone else changed the branding "
                    "while it was waiting. The draft is kept — open it and decide what to do."
                ),
                "ar": (
                    "لم يُنشر المسوّدة «{{draft_name}}»: غيّر شخص آخر الهوية البصرية أثناء الانتظار. "
                    "المسوّدة محفوظة — افتحها وقرّر ما يجب فعله."
                ),
                "zh": (
                    "草稿「{{draft_name}}」未发布：等待期间其他人修改了品牌外观。"
                    "草稿已保留——请打开它并决定如何处理。"
                ),
            },
            audience=AUDIENCE_HOTEL,
            placeholders=("version", "draft_name", "delay_seconds"),
        ),
    )
}


def get(code: str) -> EventSpec:
    """Событие по коду. Неизвестный код — ошибка программы, а не отеля."""
    try:
        return EVENTS[code]
    except KeyError:
        raise LookupError(f"Событие «{code}» не заведено в справочнике уведомлений") from None


def placeholders_in(text: str) -> set[str]:
    return set(_PLACEHOLDER.findall(text or ""))


def fill(template: str, values: dict) -> str:
    """
    Подстановка ровно известных полей.

    Поля НЕТ (не передано, None) — прочерк: текст без одного поля всё равно
    говорит, что случилось, а исключение не говорит ничего. Поле ПУСТОЕ —
    пустота: «комментария нет» не должно превращаться в строку с прочерком.
    """

    def replace(match: re.Match) -> str:
        value = values.get(match.group(1))
        return "—" if value is None else str(value)

    return _PLACEHOLDER.sub(replace, str(template or "")).strip()


def render(code: str, values: dict, *, language: str, default_language: str) -> RenderedMessage:
    spec = get(code)
    filled = dict(values)
    for field, word_key in spec.defaults:
        if filled.get(field) in (None, ""):
            filled[field] = word(word_key, language, default_language)
    return RenderedMessage(
        subject=fill(spec.text("subject", language, default_language), filled),
        body=fill(spec.text("body", language, default_language), filled),
    )


def catalog(language: str) -> list[dict]:
    """Справочник для экрана настроек: код, название, адресат, подстановки."""
    return [
        {
            "code": spec.code,
            "title": spec.text("title", language, FALLBACK_LANGUAGE),
            "audience": spec.audience,
            "placeholders": list(spec.placeholders),
        }
        for spec in EVENTS.values()
    ]
