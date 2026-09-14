"""
RLS для назначенных заданий.

Урок прошлого захода применён СРАЗУ, а не после падения сторожа: в задании лежит
решение отеля о будущем виде его витрины, и дырявый скоуп означал бы, что чужой
отель видит и отменяет чужие публикации.

Пульс службы (`core_scheduler_heartbeat`) политики НЕ получает намеренно: служба
одна на весь флот, отеля у неё нет, а читает её консоль платформы, у которой
тенант не выставлен. Под политикой пульс молча вернулся бы пустым — тот самый
класс отказа, где «пусто» неотличимо от «нет доступа».
"""

from django.db import migrations

from apps.core import rls

TABLES = ["core_scheduled_job"]


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0018_scheduled_jobs"),
    ]

    operations = [
        migrations.RunSQL(
            sql=rls.enable_sql(TABLES),
            reverse_sql=rls.disable_sql(TABLES),
        ),
    ]
