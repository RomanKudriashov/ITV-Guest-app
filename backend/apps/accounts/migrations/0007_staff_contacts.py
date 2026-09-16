"""
Контакты сотрудника: мессенджеры с отметкой подтверждения и одноразовые коды
привязки. RLS для кодов — следующей миграцией (core/0024).
"""

import apps.core.fields
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0006_staff_session'),
        ('hotels', '0033_room_fund_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='max_confirmed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='max_user_id',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='user',
            name='telegram_chat_id',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='user',
            name='telegram_confirmed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='telegram_username',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.CreateModel(
            name='ContactBindingCode',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('messenger', models.CharField(choices=[('telegram', 'Telegram'), ('max', 'Max')], max_length=16)),
                ('code_hash', models.CharField(max_length=64, unique=True)),
                ('expires_at', models.DateTimeField()),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('external_id', models.CharField(blank=True, max_length=64)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('hotel', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='%(class)ss', to='hotels.hotel')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='binding_codes', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'accounts_contact_binding_code',
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['user', 'messenger', 'used_at'], name='accounts_co_user_id_419fad_idx')],
            },
            bases=(apps.core.fields.TranslatableMixin, models.Model),
        ),
    ]
