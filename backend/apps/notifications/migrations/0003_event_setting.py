"""
Настройки событий уведомлений: решение отеля о событиях справочника.

Строки нет — действует значение по умолчанию, поэтому данных не переносим.
RLS — следующей миграцией (core/0023).
"""

import apps.core.fields
import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hotels', '0033_room_fund_fields'),
        ('notifications', '0002_event_journal'),
    ]

    operations = [
        migrations.CreateModel(
            name='EventSetting',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('code', models.CharField(max_length=64)),
                ('is_enabled', models.BooleanField(default=True)),
                ('audience', models.CharField(blank=True, max_length=16)),
                ('channel_types', models.JSONField(blank=True, default=list)),
                ('templates', models.JSONField(blank=True, default=dict)),
                ('channel', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='notifications.notificationchannel')),
                ('hotel', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='%(class)ss', to='hotels.hotel')),
            ],
            options={
                'db_table': 'notifications_event_setting',
                'constraints': [models.UniqueConstraint(fields=('hotel', 'code'), name='uniq_event_setting_per_hotel')],
            },
            bases=(apps.core.fields.TranslatableMixin, models.Model),
        ),
    ]
