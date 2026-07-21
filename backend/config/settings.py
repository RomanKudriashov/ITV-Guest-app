"""
Настройки ITV-Guest-app.

Ключевое отличие от обычного Django-проекта — ДВА подключения к одной и той
же базе:

    default   — роль приложения, подчиняется RLS. Всё, что обслуживает
                гостевые и персональные запросы, идёт сюда.
    platform  — платформенная роль с BYPASSRLS. Миграции и кросс-отельный
                платформенный уровень. См. infra/postgres/init/01-roles.sh
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# .env лежит в корне монорепо, на уровень выше backend/
load_dotenv(BASE_DIR.parent / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    raw = os.getenv(name, default)
    return [part.strip() for part in raw.split(",") if part.strip()]


# --- Базовое ---------------------------------------------------------------

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "*")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "channels",
    # Порядок важен только для читаемости: hotels — корень тенанта.
    "apps.core",
    "apps.hotels",
    "apps.accounts",
    "apps.catalog",
    "apps.orders",
    "apps.media",
    "apps.notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    # Тенант резолвится ДО всего прикладного кода: он выставляет и contextvar,
    # и сессионную переменную Postgres, от которой зависят RLS-политики.
    "apps.core.middleware.TenantMiddleware",
    "apps.core.middleware.LanguageMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

AUTH_USER_MODEL = "accounts.User"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Внутреннее время всегда UTC; всё, что показываем и по чему считаем
# расписания, приводится к таймзоне отеля (Hotel.timezone).
USE_TZ = True
TIME_ZONE = "UTC"
USE_I18N = False  # переводы контента у нас свои, через TranslatableField

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"


# --- База данных -----------------------------------------------------------

_PG_COMMON = {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": os.getenv("POSTGRES_DB", "guestapp"),
    "HOST": os.getenv("POSTGRES_HOST", "localhost"),
    "PORT": os.getenv("POSTGRES_PORT", "5432"),
    "CONN_MAX_AGE": 0,
}

DATABASES = {
    "default": {
        **_PG_COMMON,
        "USER": os.getenv("POSTGRES_USER", "guestapp"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "guestapp"),
    },
    "platform": {
        **_PG_COMMON,
        "USER": os.getenv("POSTGRES_PLATFORM_USER", "guestapp_platform"),
        "PASSWORD": os.getenv("POSTGRES_PLATFORM_PASSWORD", "guestapp_platform"),
        # Это не реплика, а та же самая база под другой ролью. MIRROR говорит
        # тест-раннеру не создавать для неё отдельную тестовую БД.
        "TEST": {"MIRROR": "default"},
    },
}

DATABASE_ROUTERS = ["apps.core.routers.PlatformAliasRouter"]


# --- Мультитенантность -----------------------------------------------------

# Базовый домен, от которого отрезается поддомен отеля:
#   crystal.guest.localhost -> subdomain "crystal"
GUEST_APP_BASE_DOMAIN = os.getenv("GUEST_APP_BASE_DOMAIN", "guest.localhost")

# Поддомены платформенного уровня — тенантом не считаются.
GUEST_APP_RESERVED_SUBDOMAINS = set(
    env_list("GUEST_APP_RESERVED_SUBDOMAINS", "www,api,admin,platform,static,media")
)

# В деве удобно уметь подменять тенанта заголовком/квери-параметром, не поднимая
# wildcard-DNS. В проде выключено жёстко.
GUEST_APP_ALLOW_TENANT_OVERRIDE_HEADER = DEBUG

DEFAULT_LANGUAGE = "en"
SUPPORTED_LANGUAGES = ["ru", "en", "ar", "zh"]


# --- Redis / Celery / Channels --------------------------------------------

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", False)
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_DEFAULT_RETRY_DELAY = 5
CELERY_TASK_MAX_RETRIES = 5

CHANNELS_REDIS_URL = os.getenv("CHANNELS_REDIS_URL", "redis://localhost:6379/3")
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [CHANNELS_REDIS_URL]},
    }
}

# Канал Redis pub/sub, в который событийная шина складывает конверты событий.
EVENT_BUS_CHANNEL_PREFIX = "guestapp.events"


# --- MinIO -----------------------------------------------------------------

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_PUBLIC_ENDPOINT = os.getenv("MINIO_PUBLIC_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "guest-media")
MINIO_SECURE = env_bool("MINIO_SECURE", False)

# Варианты, которые генерирует медиапайплайн (ширина в px).
MEDIA_VARIANTS = {"thumb": 200, "card": 600, "full": 1200}


# --- Аутентификация --------------------------------------------------------

JWT_SECRET = os.getenv("JWT_SECRET", SECRET_KEY)
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TTL_MINUTES = int(os.getenv("JWT_ACCESS_TTL_MINUTES", "60"))
JWT_REFRESH_TTL_DAYS = int(os.getenv("JWT_REFRESH_TTL_DAYS", "14"))
GUEST_SESSION_TTL_HOURS = int(os.getenv("GUEST_SESSION_TTL_HOURS", "12"))


# --- Уведомления и эскалация -----------------------------------------------

# Глобальный выключатель. В тестах — 0, чтобы движок не планировал ступени на
# каждый созданный заказ; тесты эскалации включают его точечно.
NOTIFICATIONS_ENABLED = env_bool("NOTIFICATIONS_ENABLED", True)

# База API Telegram — вынесена в настройку, чтобы тесты подменяли её на
# локальную заглушку и не ходили наружу.
TELEGRAM_API_URL = os.getenv("TELEGRAM_API_URL", "https://api.telegram.org")

EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "25"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", False)
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@guest.localhost")


# --- Интеграционные швы ----------------------------------------------------
# Реализации в этом прогоне не пишем — только интерфейс и адаптер «нет».

PMS_ADAPTER = os.getenv("PMS_ADAPTER", "null")
PAYMENT_ADAPTER = os.getenv("PAYMENT_ADAPTER", "null")


# --- Логи ------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)-7s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.db.backends": {"level": "WARNING"},
        "apps": {"level": "DEBUG" if DEBUG else "INFO"},
    },
}
