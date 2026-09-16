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

ПО УМОЛЧАНИЮ ВКЛЮЧЕНО ТОЛЬКО ТО, ЧТО ТРЕБУЕТ ДЕЙСТВИЯ: просрочка, отмена,
низкая оценка, недоставленное уведомление. Остальное отель включает сам:
канал, в который сыплется всё подряд, перестают читать — и пропускают ровно
то, ради чего он заведён.
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
    # Включено, пока отель не решил иначе. Только для того, что требует действия.
    enabled_by_default: bool = False
    # Адресата выбирает не настройка события, а своё правило: у просрочки это
    # ступени эскалации. Экран показывает «кому» ссылкой на правило.
    audience_from_rules: bool = False

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
    # Причины отмены — коды `Order.CancelReason`. Подпись модели только русская,
    # а отмена уходит старшему на его языке.
    "cancel_reason.out_of_stock": {
        "ru": "Нет в наличии",
        "en": "Out of stock",
        "ar": "غير متوفر",
        "zh": "缺货",
    },
    "cancel_reason.guest_refused": {
        "ru": "Гость отказался",
        "en": "The guest cancelled",
        "ar": "ألغى الضيف الطلب",
        "zh": "客人已取消",
    },
    "cancel_reason.no_capacity": {
        "ru": "Некому выполнить",
        "en": "No one available to fulfil it",
        "ar": "لا يوجد من ينفذ الطلب",
        "zh": "无人可处理",
    },
    "cancel_reason.duplicate": {
        "ru": "Дубль заявки",
        "en": "Duplicate request",
        "ar": "طلب مكرر",
        "zh": "重复请求",
    },
    "cancel_reason.mistake": {
        "ru": "Ошиблись при оформлении",
        "en": "Entered by mistake",
        "ar": "أُدخل بالخطأ",
        "zh": "下单有误",
    },
    "cancel_reason.other": {"ru": "Другое", "en": "Other", "ar": "أخرى", "zh": "其他"},
}


def word(key: str, language: str, default_language: str = FALLBACK_LANGUAGE, **values) -> str:
    table = WORDS[key]
    for candidate in (language, default_language, FALLBACK_LANGUAGE):
        if candidate in table:
            return table[candidate].format(**values)
    return ""


def localized(value: dict, language: str, default_language: str = FALLBACK_LANGUAGE) -> str:
    """
    Подстановка, зависящая от языка: `{"ru": …, "en": …}`.

    Данные события пишутся в журнал один раз, а текст собирается на языке
    каждого получателя — поэтому название отдела или события лежит в данных
    всеми переводами сразу, а выбирается здесь.
    """
    for candidate in (language, default_language, FALLBACK_LANGUAGE):
        if candidate and value.get(candidate):
            return str(value[candidate])
    return next((str(text) for text in value.values() if text), "")


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
            enabled_by_default=True,
            audience_from_rules=True,
        ),
        EventSpec(
            code="order.cancelled",
            title={
                "ru": "Заявку отменили",
                "en": "Request cancelled",
                "ar": "أُلغي الطلب",
                "zh": "请求已取消",
            },
            subject={
                "ru": "Заявка №{{number}} отменена — {{point}}",
                "en": "Request #{{number}} cancelled — {{point}}",
                "ar": "أُلغي الطلب رقم {{number}} — {{point}}",
                "zh": "请求 #{{number}} 已取消 — {{point}}",
            },
            body={
                "ru": "{{room}}\n{{summary}}\nПричина: {{reason}}\n{{comment}}",
                "en": "{{room}}\n{{summary}}\nReason: {{reason}}\n{{comment}}",
                "ar": "{{room}}\n{{summary}}\nالسبب: {{reason}}\n{{comment}}",
                "zh": "{{room}}\n{{summary}}\n原因：{{reason}}\n{{comment}}",
            },
            # Отдел должен остановить работу: готовить уже не для кого.
            audience=AUDIENCE_POINT,
            placeholders=("number", "room", "point", "summary", "reason", "comment"),
            enabled_by_default=True,
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
            # Каждое сообщение гостя в чат отдела — ровно тот поток, от
            # которого канал перестают читать. Чат и так виден на экране.
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
            enabled_by_default=True,
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
        EventSpec(
            code="notification.undelivered",
            title={
                "ru": "Уведомление не доставлено",
                "en": "Notification not delivered",
                "ar": "لم يُسلَّم الإشعار",
                "zh": "通知未送达",
            },
            subject={
                "ru": "Не доставлено: {{event}}",
                "en": "Not delivered: {{event}}",
                "ar": "لم يُسلَّم: {{event}}",
                "zh": "未送达：{{event}}",
            },
            body={
                "ru": (
                    "Канал «{{channel}}» не принял сообщение «{{subject}}» после всех попыток.\n"
                    "{{error}}\nПроверьте настройки канала — пока они не исправлены, сюда "
                    "ничего не приходит."
                ),
                "en": (
                    "Channel “{{channel}}” did not accept the message “{{subject}}” after all "
                    "attempts.\n{{error}}\nCheck the channel settings — nothing reaches it "
                    "until they are fixed."
                ),
                "ar": (
                    "لم تقبل القناة «{{channel}}» الرسالة «{{subject}}» بعد كل المحاولات.\n"
                    "{{error}}\nتحقق من إعدادات القناة — لن يصل إليها شيء حتى يتم إصلاحها."
                ),
                "zh": (
                    "渠道「{{channel}}」在多次尝试后仍未接收消息「{{subject}}」。\n"
                    "{{error}}\n请检查渠道设置——修复之前，该渠道收不到任何消息。"
                ),
            },
            # Сломанный канал — дело администратора отеля, а не отдела,
            # чей канал и сломан.
            audience=AUDIENCE_HOTEL,
            placeholders=("event", "channel", "subject", "error"),
            enabled_by_default=True,
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


def fill(
    template: str,
    values: dict,
    language: str = FALLBACK_LANGUAGE,
    default_language: str = FALLBACK_LANGUAGE,
) -> str:
    """
    Подстановка ровно известных полей.

    Поля НЕТ (не передано, None) — прочерк: текст без одного поля всё равно
    говорит, что случилось, а исключение не говорит ничего. Поле ПУСТОЕ —
    пустота: «комментария нет» не должно превращаться в строку с прочерком.
    Пустые строки, оставшиеся от пустых полей, из текста убираются.
    """

    def replace(match: re.Match) -> str:
        value = values.get(match.group(1))
        if isinstance(value, dict):
            return localized(value, language, default_language)
        return "—" if value is None else str(value)

    text = _PLACEHOLDER.sub(replace, str(template or ""))
    return "\n".join(line for line in text.splitlines() if line.strip()).strip()


def fill_values(spec: EventSpec, values: dict, language: str, default_language: str) -> dict:
    """Данные события с готовыми словами на месте пустых полей."""
    filled = dict(values)
    for field, word_key in spec.defaults:
        if filled.get(field) in (None, ""):
            filled[field] = word(word_key, language, default_language)
    return filled


def render(
    code: str,
    values: dict,
    *,
    language: str,
    default_language: str,
    templates: dict | None = None,
) -> RenderedMessage:
    """
    Текст на языке получателя.

    `templates` — текст отеля для события (`{язык: {subject, body}}`). Порядок —
    тот же, что у эскалации: текст отеля на языке получателя → текст
    справочника на нём же → текст отеля на языке отеля → справочник по
    запасному языку. Русский текст отеля не перебивает английский справочника
    у англоязычного получателя.
    """
    spec = get(code)
    template = pick_template(spec, templates or {}, language, default_language)
    filled = fill_values(spec, values, language, default_language)
    return RenderedMessage(
        subject=fill(template["subject"], filled, language, default_language),
        body=fill(template["body"], filled, language, default_language),
    )


def pick_template(spec: EventSpec, templates: dict, language: str, default_language: str) -> dict:
    def own(lang: str) -> dict | None:
        entry = templates.get(lang) or {}
        if entry.get("subject") or entry.get("body"):
            return {"subject": entry.get("subject", ""), "body": entry.get("body", "")}
        return None

    def registry(lang: str) -> dict:
        return {
            "subject": spec.text("subject", lang, default_language),
            "body": spec.text("body", lang, default_language),
        }

    found = own(language)
    if found:
        return found
    if language in LANGUAGES:
        return registry(language)
    return own(default_language) or registry(language)


def catalog(language: str) -> list[dict]:
    """Справочник для экрана настроек: код, название, адресат, подстановки."""
    return [
        {
            "code": spec.code,
            "title": spec.text("title", language, FALLBACK_LANGUAGE),
            "audience": spec.audience,
            "placeholders": list(spec.placeholders),
            "enabled_by_default": spec.enabled_by_default,
            "audience_from_rules": spec.audience_from_rules,
            # Тексты справочника — чтобы экран показал, что уйдёт, пока отель
            # своего не написал.
            "defaults": {
                lang: {"subject": spec.subject.get(lang, ""), "body": spec.body.get(lang, "")}
                for lang in LANGUAGES
            },
        }
        for spec in EVENTS.values()
    ]
