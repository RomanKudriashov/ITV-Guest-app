"""
Бэкфилл гостевых полей точек исполнения.

Зеркалит apps.hotels.venue_defaults.default_guest_facing: гостевые — те, у кого
есть активная замаршрутизированная активная категория И род не служебный
(housekeeping). public_name копируем из служебного title. Держите SQL и функцию
синхронными.

RLS не мешает: на стенде/проде бэкфилл гоняет платформенная роль с BYPASSRLS
(migrate --database=platform), а в тестах таблица на момент миграции пуста —
UPDATE просто ничего не трогает (сид создаёт точки позже, уже с новой моделью).
"""

from django.db import migrations

_BACKFILL = """
UPDATE hotels_execution_point
   SET public_name = title
 WHERE public_name = '{}'::jsonb OR public_name IS NULL;

UPDATE hotels_execution_point ep
   SET is_guest_facing = (
       ep.kind <> 'housekeeping'
       AND EXISTS (
           SELECT 1 FROM catalog_route r
             JOIN catalog_category c ON c.id = r.category_id
            WHERE r.execution_point_id = ep.id
              AND r.is_active AND c.is_active
       )
   );
"""


class Migration(migrations.Migration):
    dependencies = [
        ("hotels", "0008_executionpoint_is_guest_facing_and_more"),
        ("catalog", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=_BACKFILL, reverse_sql=migrations.RunSQL.noop),
    ]
