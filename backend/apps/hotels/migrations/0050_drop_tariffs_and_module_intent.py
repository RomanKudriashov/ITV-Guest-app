"""
Тарифов нет — их поля уходят из схемы (партия 62-E2).

Удаляются: `Hotel.tariff`, `Hotel.tariff_started_on`, `Hotel.trial_ends_at`,
`OnboardingTemplate.tariff`, `HotelModule.intent`. С партии 62-E1 код их не
читает и не пишет (сторож — `test_modules_62e1`).

ОБРАТНЫЙ ХОД РАБОТАЕТ: поля возвращаются пустыми (тариф и намерение — пустая
строка, даты — NULL). Он нужен для отката на 3ab91c9: тот код поля уже не
читает, но модель их объявляет, и без столбцов падал бы любой запрос к отелю.
Значения не восстанавливаются — их никто не читал с 62-E1.

Подписи вариантов `HotelModule.Code` приведены к экранным словам в модели;
схемы они не меняют: у поля `code` нет `choices`.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('hotels', '0049_modules_in_development_off'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='hotel',
            name='tariff',
        ),
        migrations.RemoveField(
            model_name='hotel',
            name='tariff_started_on',
        ),
        migrations.RemoveField(
            model_name='hotel',
            name='trial_ends_at',
        ),
        migrations.RemoveField(
            model_name='hotelmodule',
            name='intent',
        ),
        migrations.RemoveField(
            model_name='onboardingtemplate',
            name='tariff',
        ),
    ]
