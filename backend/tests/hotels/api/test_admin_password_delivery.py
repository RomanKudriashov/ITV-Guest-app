"""
Пароль администратора отеля не достаётся оператору платформы.

Возврат пароля в теле ответа был готовым захватом тенанта: вошедший в консоль
получал полный доступ в CMS любого отеля, а отель об этом не узнавал.

Проверка идёт ПО ЗНАЧЕНИЮ, а не по имени поля. Искать ключ `password` — значит
поймать ровно тот случай, который уже починили, и пропустить пароль,
приехавший под другим именем, внутри строки или в заголовке. Поэтому пароль
берётся из отправленного письма и ищется во всём, что ушло наружу.
"""

from __future__ import annotations

import json
import re

import pytest
from django.core import mail

from apps.accounts.models import User
from apps.core.context import platform_scope, tenant_context
from apps.core.models import AuditLog
from apps.hotels.models import Hotel
from apps.hotels.services.provisioning import ensure_platform_admin, provision_hotel

pytestmark = pytest.mark.django_db(transaction=True, databases=["default", "platform"])

BASE_HOST = "guest.localhost"
OWNER_EMAIL = "root@platform.test"
OWNER_PASSWORD = "platform12345"


@pytest.fixture
def api(client):
    ensure_platform_admin(email=OWNER_EMAIL, password=OWNER_PASSWORD)
    resp = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": OWNER_EMAIL, "password": OWNER_PASSWORD}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST,
    )
    token = resp.json()["access"]

    def call(method, path, body=None):
        kw = {"HTTP_HOST": BASE_HOST, "HTTP_AUTHORIZATION": f"Bearer {token}"}
        if body is not None:
            return getattr(client, method)(
                f"/api/v1/platform{path}", data=json.dumps(body),
                content_type="application/json", **kw,
            )
        return getattr(client, method)(f"/api/v1/platform{path}", **kw)

    return call


@pytest.fixture
def hotel():
    return provision_hotel(
        subdomain="mailed", name="Почтовый", admin_email="admin@mailed.test",
        admin_password="known-to-the-test-12345",
    ).hotel


def _password_from_letter(letter) -> str:
    """Достать пароль из письма — единственного места, где он законно есть."""
    match = re.search(r"Пароль:\s*(\S+)", letter.body)
    assert match, f"в письме нет пароля:\n{letter.body}"
    return match.group(1)


def test_password_never_reaches_the_operator(api, hotel, caplog):
    """Обыск ПО ЗНАЧЕНИЮ: ответ, заголовки, журнал аудита, логи приложения."""
    mail.outbox.clear()
    with caplog.at_level(0):
        resp = api("post", f"/hotels/{hotel.pk}/admins", {"email": "admin@mailed.test"})

    assert resp.status_code == 200, resp.content
    assert len(mail.outbox) == 1, "письмо обязано уйти ровно одно"
    password = _password_from_letter(mail.outbox[0])
    assert len(password) > 8, "пароль подозрительно короткий — проверка бессмысленна"

    # 1. Тело ответа.
    body = resp.content.decode()
    assert password not in body, f"пароль в теле ответа: {body}"
    # 2. Заголовки.
    headers = "\n".join(f"{k}: {v}" for k, v in resp.items())
    assert password not in headers, f"пароль в заголовках: {headers}"
    # 3. Журнал аудита — его читают шире, чем ответ.
    with platform_scope():
        rows = json.dumps(
            list(AuditLog.all_objects.using("platform").values("action", "payload")),
            ensure_ascii=False,
        )
    assert password not in rows, "пароль в журнале аудита"
    # 4. Логи приложения.
    assert password not in caplog.text, "пароль в логах приложения"

    # А адрес доставки оператору показать можно и нужно.
    assert resp.json()["delivered_to"] == "admin@mailed.test"


def test_letter_goes_to_the_admin_not_to_the_operator(api, hotel):
    mail.outbox.clear()
    api("post", f"/hotels/{hotel.pk}/admins", {"email": "admin@mailed.test"})

    letter = mail.outbox[0]
    assert letter.to == ["admin@mailed.test"]
    assert OWNER_EMAIL not in letter.to, "оператор не получатель"
    assert "Почтовый" in letter.body, "письмо называет отель"


def test_password_does_not_change_when_mail_fails(api, hotel, settings):
    """
    Главное: не ушло письмо — пароль ОСТАЛСЯ ПРЕЖНИМ.

    Обратный порядок оставил бы админа с работающим сбросом и без пароля,
    то есть запер бы отель.
    """
    settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
    mail.outbox.clear()

    resp = api("post", f"/hotels/{hotel.pk}/admins", {"email": "admin@mailed.test"})

    assert resp.status_code == 503, resp.content
    assert resp.json()["code"] == "mail_not_configured"
    assert not mail.outbox
    with tenant_context(hotel):
        admin = User.objects.get(email="admin@mailed.test")
    assert admin.check_password("known-to-the-test-12345"), "пароль сменился, хотя письмо не ушло"


def test_smtp_refusal_also_leaves_the_password_alone(api, hotel, monkeypatch, settings):
    """Тот же инвариант при живой настройке, но мёртвом SMTP."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

    def explode(self, *args, **kwargs):
        raise OSError("SMTP недоступен")

    monkeypatch.setattr("django.core.mail.message.EmailMessage.send", explode)

    resp = api("post", f"/hotels/{hotel.pk}/admins", {"email": "admin@mailed.test"})

    assert resp.status_code == 502
    assert resp.json()["code"] == "mail_not_sent"
    with tenant_context(hotel):
        admin = User.objects.get(email="admin@mailed.test")
    assert admin.check_password("known-to-the-test-12345")


def test_creating_a_hotel_does_not_hand_the_password_over(api):
    mail.outbox.clear()
    resp = api("post", "/hotels", {
        "subdomain": "byapi", "name": "Через консоль", "admin_email": "a@byapi.test",
    })
    assert resp.status_code == 201, resp.content

    password = _password_from_letter(mail.outbox[0])
    assert password not in resp.content.decode(), "пароль в ответе на создание отеля"
    assert resp.json()["admin"]["delivered_to"] == "a@byapi.test"


def test_hotel_is_not_created_when_mail_fails(api, settings):
    """Не ушло письмо — не появилось и отеля: половины операции не бывает."""
    settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

    resp = api("post", "/hotels", {
        "subdomain": "nomail", "name": "Без почты", "admin_email": "a@nomail.test",
    })

    assert resp.status_code == 503
    assert not Hotel.objects.filter(subdomain="nomail").exists(), "отель остался после отказа"


# --- Смена адреса администратора --------------------------------------------


def test_changing_admin_email_requires_the_owner(client, api, hotel):
    invited = api("post", "/team", {"email": "support@platform.test", "role": "support"}).json()
    login = client.post(
        "/api/v1/platform/auth/login",
        data=json.dumps({"email": "support@platform.test", "password": invited["password"]}),
        content_type="application/json", HTTP_HOST=BASE_HOST,
    )
    support = login.json()["access"]

    resp = client.put(
        f"/api/v1/platform/hotels/{hotel.pk}/admins/email",
        data=json.dumps({"current_email": "admin@mailed.test", "new_email": "new@mailed.test"}),
        content_type="application/json",
        HTTP_HOST=BASE_HOST, HTTP_AUTHORIZATION=f"Bearer {support}",
    )
    assert resp.status_code == 403, "смена адреса — не рутина поддержки"


def test_owner_changes_the_address_without_sending_anything(api, hotel):
    """
    Письма НЕ шлём: ручка нужна ровно тогда, когда старый ящик потерян.
    """
    mail.outbox.clear()
    resp = api("put", f"/hotels/{hotel.pk}/admins/email", {
        "current_email": "admin@mailed.test", "new_email": "new@mailed.test",
    })

    assert resp.status_code == 200, resp.content
    assert not mail.outbox, "смена адреса ничего не отправляет"
    with tenant_context(hotel):
        assert User.objects.filter(email="new@mailed.test", is_hotel_admin=True).exists()

    # И теперь сброс уезжает уже на новый адрес — ради этого всё и затевалось.
    api("post", f"/hotels/{hotel.pk}/admins", {"email": "new@mailed.test"})
    assert mail.outbox[-1].to == ["new@mailed.test"]


def test_address_change_lands_in_the_journal(api, hotel):
    api("put", f"/hotels/{hotel.pk}/admins/email", {
        "current_email": "admin@mailed.test", "new_email": "moved@mailed.test",
    })
    with tenant_context(hotel):
        actions = set(AuditLog.objects.values_list("action", flat=True))
    assert "platform.hotel.admin_email_changed" in actions
