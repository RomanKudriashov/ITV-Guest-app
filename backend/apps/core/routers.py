class PlatformAliasRouter:
    """
    Алиас `platform` — это не отдельная база, а та же самая под ролью с
    BYPASSRLS. Роутер намеренно ничего не маршрутизирует автоматически:
    попасть на платформенную роль можно только явным .using("platform").
    Так выход за пределы тенанта всегда виден в коде.
    """

    def db_for_read(self, model, **hints):
        return None

    def db_for_write(self, model, **hints):
        return None

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        return True
