"""
Восстановить происхождение тем, заведённых до появления `source_preset`.

ЧТО ВОССТАНАВЛИВАЕТСЯ И ПОЧЕМУ ЭТО ВОЗМОЖНО. Заведение отеля копировало токены
пресета целиком. Значит тема, чьи токены ПОБАЙТНО совпадают с каким-то
пресетом библиотеки, из него и собрана — другого способа получить ровно тот же
словарь у отеля не было.

ЧТО НЕ ВОССТАНАВЛИВАЕТСЯ И НЕ ДОЛЖНО. Тема, которую отель уже перекрасил, ни с
одним пресетом не совпадает, и угадывать её происхождение по похожести цветов
нельзя: ошибка здесь означает, что отелю потом покажут «своё оформление
поверх пресета X», которого он никогда не выбирал. Такие темы остаются без
источника — «своя тема», и это честный ответ, а не потеря данных.

Следствие, названное вслух: у отелей, перекрасивших витрину до этой миграции,
происхождение утрачено НАВСЕГДА. Восстановить его неоткуда — токены пресета
были единственным следом, и он затёрт правкой.

RLS. `hotels_brand_theme` — тенантная таблица. Под обычной ролью приложения
запрос вернул бы НОЛЬ СТРОК И НЕ УПАЛ БЫ: миграция отработала бы «успешно» и
не сделала ничего. Поэтому идём `_base_manager` по соединению миграции, а само
`migrate` на стенде и в проде гоняет платформенная роль (`--database=platform`,
BYPASSRLS) — так настроен entrypoint.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    from apps.hotels import brand_library

    BrandTheme = apps.get_model("hotels", "BrandTheme")
    db = schema_editor.connection.alias

    presets = {}
    for item in brand_library.list_presets():
        tokens = brand_library.preset_tokens(item["code"])
        if tokens:
            presets[item["code"]] = tokens

    for theme in BrandTheme.objects.using(db).filter(is_preset=False, source_preset=""):
        for code, tokens in presets.items():
            if theme.tokens == tokens:
                theme.source_preset = code
                theme.save(update_fields=["source_preset"])
                break


def noop(apps, schema_editor):
    """Обратный ход не нужен: поле уедет вместе с RemoveField."""


class Migration(migrations.Migration):
    dependencies = [("hotels", "0028_brandtheme_source_preset")]

    operations = [migrations.RunPython(backfill, noop)]
