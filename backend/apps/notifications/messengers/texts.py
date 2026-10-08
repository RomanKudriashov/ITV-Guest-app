"""
Фразы бота — на языке получателя (партия 28).

Язык — из профиля сотрудника, а пока человек ещё не привязан — из языка
его Telegram; справочник говорит на тех же четырёх языках, что уведомления.
"""

from __future__ import annotations

LANGUAGES = ("ru", "en", "ar", "zh")

PHRASES: dict[str, dict[str, str]] = {
    # Кнопки
    "take": {"ru": "Взять в работу", "en": "Take it", "ar": "استلام الطلب", "zh": "接单"},
    "open": {"ru": "Открыть в трекере", "en": "Open in tracker", "ar": "فتح في لوحة المهام", "zh": "在任务板中打开"},
    "triage": {"ru": "Разобрать", "en": "Handle", "ar": "معالجة", "zh": "处理"},
    # Строка под сообщением после действия
    "taken_by": {"ru": "Взял {name}, {time}", "en": "Taken by {name}, {time}", "ar": "استلمه {name}، {time}", "zh": "{name} 已接单，{time}"},
    "triage_by": {"ru": "Разбирает {name}, {time}", "en": "Handled by {name}, {time}", "ar": "يعالجه {name}، {time}", "zh": "{name} 正在处理，{time}"},
    "order_closed_line": {"ru": "Заказ закрыт", "en": "Order closed", "ar": "الطلب مغلق", "zh": "订单已关闭"},
    "review_closed_line": {"ru": "Разбор закрыт", "en": "Review closed", "ar": "المراجعة مغلقة", "zh": "处理已结束"},
    # Ответ на нажатие
    "taken_ok": {"ru": "Заказ ваш", "en": "The order is yours", "ar": "الطلب لك", "zh": "订单归你了"},
    "triage_ok": {"ru": "Отзыв ваш", "en": "The review is yours", "ar": "المراجعة لك", "zh": "评价由你处理"},
    "already_taken": {"ru": "Уже взял {name}", "en": "Already taken by {name}", "ar": "استلمه بالفعل {name}", "zh": "{name} 已经接单"},
    "assigned_to_other": {"ru": "Назначено: {name}", "en": "Assigned: {name}", "ar": "مُسند: {name}", "zh": "已分配：{name}"},
    "already_yours": {"ru": "Вы уже взяли этот заказ", "en": "You have already taken this order", "ar": "لقد استلمت هذا الطلب بالفعل", "zh": "你已经接了这个订单"},
    "already_triage": {"ru": "Уже разбирает {name}", "en": "Already handled by {name}", "ar": "يعالجه بالفعل {name}", "zh": "{name} 已在处理"},
    "order_closed": {"ru": "Заказ уже закрыт", "en": "The order is already closed", "ar": "الطلب مغلق بالفعل", "zh": "订单已关闭"},
    "review_closed": {"ru": "Разбор уже закрыт", "en": "The review is already closed", "ar": "المراجعة مغلقة بالفعل", "zh": "处理已结束"},
    "denied": {"ru": "Нет прав на это действие", "en": "You are not allowed to do this", "ar": "ليست لديك صلاحية لهذا الإجراء", "zh": "你无权执行此操作"},
    "not_linked": {
        "ru": "Этот Telegram не подключён в отеле этой заявки",
        "en": "This Telegram is not connected in this hotel",
        "ar": "حساب تيليجرام هذا غير مربوط في هذا الفندق",
        "zh": "此 Telegram 未在该酒店绑定",
    },
    "hotel_off": {"ru": "Отель выключил уведомления в Telegram", "en": "The hotel has turned Telegram notifications off", "ar": "أوقف الفندق إشعارات تيليجرام", "zh": "酒店已关闭 Telegram 通知"},
    "not_found": {"ru": "Не найдено — возможно, удалено", "en": "Not found — it may have been deleted", "ar": "غير موجود — ربما حُذف", "zh": "未找到，可能已被删除"},
    "stale": {"ru": "Кнопка устарела", "en": "This button is outdated", "ar": "هذا الزر قديم", "zh": "此按钮已失效"},
    # Привязка
    "linked": {"ru": "Подключено: {name}, {hotel}", "en": "Connected: {name}, {hotel}", "ar": "تم الربط: {name}، {hotel}", "zh": "已绑定：{name}，{hotel}"},
    "linked_hint": {
        "ru": "Сюда будут приходить рабочие уведомления. Отключить — командой /stop или в профиле.",
        "en": "Work notifications will arrive here. To disconnect, send /stop or use your profile.",
        "ar": "ستصلك إشعارات العمل هنا. لإلغاء الربط أرسل /stop أو استخدم ملفك الشخصي.",
        "zh": "工作通知将发送到这里。发送 /stop 或在个人资料中解除绑定。",
    },
    "bind_unknown": {"ru": "Код не найден. Получите новый в профиле: «Подключить Telegram».", "en": "Code not found. Get a new one in your profile: “Connect Telegram”.", "ar": "الرمز غير موجود. احصل على رمز جديد من ملفك الشخصي.", "zh": "未找到代码。请在个人资料中重新获取。"},
    "bind_used": {"ru": "Этот код уже использован.", "en": "This code has already been used.", "ar": "تم استخدام هذا الرمز بالفعل.", "zh": "此代码已被使用。"},
    "bind_revoked": {"ru": "Этот код заменён новым — откройте последнюю ссылку из профиля.", "en": "This code was replaced by a newer one — open the latest link from your profile.", "ar": "تم استبدال هذا الرمز برمز أحدث — افتح أحدث رابط من ملفك الشخصي.", "zh": "此代码已被新代码取代，请打开个人资料中的最新链接。"},
    "bind_expired": {"ru": "Код истёк: он действует 10 минут. Получите новый в профиле.", "en": "The code has expired (it lasts 10 minutes). Get a new one in your profile.", "ar": "انتهت صلاحية الرمز (10 دقائق). احصل على رمز جديد من ملفك الشخصي.", "zh": "代码已过期（有效期 10 分钟）。请在个人资料中重新获取。"},
    "bind_inactive": {"ru": "Учётная запись сотрудника отключена.", "en": "The staff account is disabled.", "ar": "حساب الموظف معطل.", "zh": "员工账号已停用。"},
    "bind_taken": {"ru": "Этот Telegram уже подключён к другому сотруднику этого отеля.", "en": "This Telegram is already connected to another staff member of this hotel.", "ar": "حساب تيليجرام هذا مربوط بموظف آخر في هذا الفندق.", "zh": "此 Telegram 已绑定到该酒店的其他员工。"},
    "bind_hotel_off": {"ru": "Отель выключил уведомления в Telegram.", "en": "The hotel has turned Telegram notifications off.", "ar": "أوقف الفندق إشعارات تيليجرام.", "zh": "酒店已关闭 Telegram 通知。"},
    "bind_no_account": {"ru": "Не удалось определить ваш аккаунт Telegram.", "en": "Could not identify your Telegram account.", "ar": "تعذر تحديد حساب تيليجرام الخاص بك.", "zh": "无法识别你的 Telegram 账号。"},
    # Группа смены через бота платформы (партия 32)
    "group_connected": {
        "ru": "Группа подключена: «{title}» — {where}, {hotel}. Сюда будут приходить уведомления смены. Отключить — в панели отеля.",
        "en": "Group connected: “{title}” — {where}, {hotel}. Shift notifications will arrive here. Disconnect in the hotel panel.",
        "ar": "تم ربط المجموعة: «{title}» — {where}، {hotel}. ستصل إشعارات المناوبة هنا. يمكن الفصل من لوحة الفندق.",
        "zh": "群组已连接：「{title}」— {where}，{hotel}。值班通知将发送到这里。可在酒店后台断开。",
    },
    "group_hotel_wide": {"ru": "весь отель", "en": "whole hotel", "ar": "الفندق بأكمله", "zh": "整个酒店"},
    "group_code_unknown": {"ru": "Код не найден. Получите новый в панели отеля: «Уведомления → Каналы».", "en": "Code not found. Get a new one in the hotel panel: Notifications → Channels.", "ar": "الرمز غير موجود. احصل على رمز جديد من لوحة الفندق: الإشعارات ← القنوات.", "zh": "未找到代码。请在酒店后台“通知 → 渠道”中重新获取。"},
    "group_code_expired": {"ru": "Код истёк: он действует 30 минут. Получите новый в панели отеля.", "en": "The code has expired (it lasts 30 minutes). Get a new one in the hotel panel.", "ar": "انتهت صلاحية الرمز (30 دقيقة). احصل على رمز جديد من لوحة الفندق.", "zh": "代码已过期（有效期 30 分钟）。请在酒店后台重新获取。"},
    "group_disconnect_in_panel": {"ru": "Отключить группу можно только в панели отеля — так её не оборвёт случайное сообщение.", "en": "The group can only be disconnected in the hotel panel, so a stray message can't cut it off.", "ar": "لا يمكن فصل المجموعة إلا من لوحة الفندق، كي لا تقطعها رسالة عابرة.", "zh": "只能在酒店后台断开群组，以免被随意的消息误断。"},
    "group_added_hint": {"ru": "Чтобы сюда приходили уведомления смены, отправьте /connect и код из панели отеля («Уведомления → Каналы → Telegram-группа»).", "en": "To receive shift notifications here, send /connect with the code from the hotel panel (Notifications → Channels → Telegram group).", "ar": "لتلقي إشعارات المناوبة هنا، أرسل ‎/connect مع الرمز من لوحة الفندق (الإشعارات ← القنوات ← مجموعة تيليجرام).", "zh": "要在此接收值班通知，请发送 /connect 加上酒店后台的代码（通知 → 渠道 → Telegram 群组）。"},
    "connect_in_group_only": {"ru": "Команда /connect — для группы: добавьте бота в чат смены и отправьте её там.", "en": "/connect is for a group: add the bot to the shift chat and send it there.", "ar": "الأمر ‎/connect مخصص للمجموعات: أضف البوت إلى محادثة المناوبة وأرسله هناك.", "zh": "/connect 用于群组：请把机器人加入值班群并在群内发送。"},
    "group_farewell": {"ru": "Канал «{title}» отключён в панели отеля — бот выходит из группы.", "en": "Channel “{title}” was disconnected in the hotel panel — the bot is leaving the group.", "ar": "تم فصل القناة «{title}» من لوحة الفندق — البوت يغادر المجموعة.", "zh": "渠道「{title}」已在酒店后台断开——机器人将退出群组。"},
    "group_only_private": {"ru": "Подключение — только в личном чате с ботом.", "en": "Connect only in a private chat with the bot.", "ar": "الربط متاح فقط في محادثة خاصة مع البوت.", "zh": "只能在与机器人的私聊中绑定。"},
    # Команды
    "help_unbound": {
        "ru": "Этот бот присылает рабочие уведомления сотрудникам отеля. Подключение — в профиле: «Подключить Telegram».",
        "en": "This bot sends work notifications to hotel staff. Connect it in your profile: “Connect Telegram”.",
        "ar": "يرسل هذا البوت إشعارات العمل لموظفي الفندق. اربطه من ملفك الشخصي.",
        "zh": "此机器人向酒店员工发送工作通知。请在个人资料中绑定。",
    },
    "help_bound": {"ru": "Подключено: {list}. Отключить — /stop.", "en": "Connected: {list}. To disconnect, send /stop.", "ar": "مربوط: {list}. لإلغاء الربط أرسل /stop.", "zh": "已绑定：{list}。发送 /stop 解除绑定。"},
    "unlinked": {"ru": "Отключено: {list}. Уведомления сюда больше не придут.", "en": "Disconnected: {list}. No more notifications will arrive here.", "ar": "تم إلغاء الربط: {list}. لن تصل الإشعارات إلى هنا بعد الآن.", "zh": "已解除绑定：{list}。将不再收到通知。"},
    "not_bound": {"ru": "Этот Telegram ни к кому не подключён.", "en": "This Telegram is not connected to anyone.", "ar": "حساب تيليجرام هذا غير مربوط بأحد.", "zh": "此 Telegram 未绑定任何账号。"},
}


def language_of(value: str) -> str:
    base = (value or "").strip().lower().replace("_", "-").split("-")[0]
    return base if base in LANGUAGES else "ru"


def say(key: str, language: str, **values) -> str:
    phrase = PHRASES[key]
    text = phrase.get(language_of(language)) or phrase["ru"]
    return text.format(**values) if values else text
