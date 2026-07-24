"""
Реестр тенант-таблиц — единственный источник правды о том, что защищено RLS.

Читается миграцией apps/core/migrations/0002_rls.py и тестом-сторожем
tests/test_rls_coverage.py. При добавлении новой тенант-таблицы её имя
дописывается сюда и создаётся новая миграция с rls.enable_sql([...]).

hotels_hotel и media_category_placeholder намеренно без RLS: это платформенный
уровень, у них нет hotel_id. Отель обязан быть находимым по поддомену ещё до
того, как установлен контекст тенанта.
"""

# Строгая политика: строка видна, только если hotel_id совпадает с
# сессионной переменной app.current_hotel. Нет контекста — нет строк.
TENANT_TABLES = [
    # hotels
    "hotels_brand_theme",
    "hotels_hotel_language",
    "hotels_room",
    "hotels_execution_point",
    "hotels_location",
    "hotels_schedule",
    "hotels_schedule_interval",
    "hotels_showcase_tile",
    # accounts
    "accounts_user",
    "accounts_staff_assignment",
    "accounts_guest_session",
    # catalog
    "catalog_category",
    "catalog_item",
    "catalog_item_image",
    "catalog_modifier_group",
    "catalog_modifier_option",
    "catalog_request_field",
    "catalog_slot_config",
    "catalog_slot_booking",
    "catalog_route",
    "catalog_service_location",
    "catalog_badge",
    "catalog_item_badge",
    # orders
    "orders_status_definition",
    "orders_order",
    "orders_order_item",
    "orders_order_status_change",
    # notifications
    "notifications_channel",
    "notifications_escalation_rule",
    "notifications_escalation_step",
    "notifications_log",
    # media
    "media_asset",
    # core
    "core_idempotency_key",
    "chat_thread",
    "chat_message",
    "reviews_review",
    # analytics
    "analytics_event",
    "analytics_order_daily",
    "analytics_item_daily",
    "analytics_modifier_daily",
    "analytics_session_daily",
    "analytics_review_daily",
    "analytics_export",
]

# Таблицы, где hotel_id необязателен (платформенные действия). Читать такие
# строки может только платформенная роль; писать можно из любого контекста —
# иначе платформенный аудит было бы негде хранить.
NULLABLE_TENANT_TABLES = [
    "core_audit_log",
    "accounts_impersonation_grant",
]

PLATFORM_TABLES = [
    "hotels_hotel",
    "media_category_placeholder",
]
