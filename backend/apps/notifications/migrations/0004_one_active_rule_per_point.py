"""
Одно активное правило эскалации на точку — запретом в базе (бэклог 39).

ПЕРЕД индексом — ПРОВЕРКА, И ОНА ТОЛЬКО ГОВОРИТ. Дубль уже живёт на стенде
(«Кристалл», СПА: «SPA-центр…» и «СПА «Кристалл»…»). Индекс на нём упал бы
невнятным `could not create unique index`, а «починить» дубль сама миграция
не вправе: какое из двух правил выключить — решение человека. Поэтому она
называет точку и правила и падает, ничего не меняя. Выключить лишнее —
штатным способом (панель или `PATCH /cms/escalation-rules/{id}`), потом
повторить миграцию.

RLS. Проверка — сырым SQL на соединении миграции. Индекс создаёт только
владелец таблицы, то есть платформенная роль (`migrate --database=platform`),
а у неё BYPASSRLS — проверка видит строки всех отелей. Под обычной ролью
миграция упала бы на самом DDL («must be owner»), так что тихого «дублей нет»
при слепой проверке не бывает.
"""

from django.db import migrations, models

DUPLICATES_SQL = """
    SELECT h.subdomain,
           COALESCE(p.code, '<общее правило отеля>') AS point,
           string_agg(r.id::text || ' «' || r.name || '»', '; ' ORDER BY r.created_at) AS rules
      FROM notifications_escalation_rule r
      JOIN hotels_hotel h ON h.id = r.hotel_id
 LEFT JOIN hotels_execution_point p ON p.id = r.execution_point_id
     WHERE r.is_active AND r.deleted_at IS NULL
  GROUP BY h.subdomain, r.hotel_id, r.execution_point_id, p.code
    HAVING count(*) > 1
  ORDER BY h.subdomain, point
"""


def refuse_on_duplicates(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(DUPLICATES_SQL)
        duplicates = cursor.fetchall()
    if not duplicates:
        return
    lines = "\n".join(f"  отель {hotel}, точка {point}: {rules}" for hotel, point, rules in duplicates)
    raise RuntimeError(
        "Нельзя создать запрет «одно активное правило эскалации на точку»: "
        "на этих точках активных правил больше одного.\n"
        f"{lines}\n"
        "Миграция ничего не выключает сама — какое правило оставить, решает человек. "
        "Выключите лишнее штатно (панель «Уведомления → Передача выше» или "
        "PATCH /api/v1/cms/escalation-rules/<id> {\"is_active\": false}) и повторите migrate."
    )


def noop(apps, schema_editor):
    """Откат снимает индексы; проверять при откате нечего."""


class Migration(migrations.Migration):

    dependencies = [
        ('hotels', '0041_zones_to_buildings'),
        ('notifications', '0003_event_setting'),
    ]

    operations = [
        migrations.RunPython(refuse_on_duplicates, noop),
        migrations.AddConstraint(
            model_name='escalationrule',
            constraint=models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True), ('execution_point__isnull', False), ('is_active', True)), fields=('hotel', 'execution_point'), name='uniq_active_rule_per_point'),
        ),
        migrations.AddConstraint(
            model_name='escalationrule',
            constraint=models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True), ('execution_point__isnull', True), ('is_active', True)), fields=('hotel',), name='uniq_active_default_rule_per_hotel'),
        ),
    ]
