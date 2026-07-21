"""
Доменные ошибки.

Сервисный слой бросает их, не зная ничего про HTTP; превращение в ответ —
в одном месте (api/__init__.py). Так одна и та же логика одинаково ведёт себя
и в API, и в management-команде, и в Celery-задаче.
"""

from __future__ import annotations


class DomainError(Exception):
    status = 400
    code = "error"

    def __init__(self, detail: str, *, code: str | None = None, **extra):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code
        self.extra = extra

    def to_response(self) -> dict:
        return {"detail": self.detail, "code": self.code, **self.extra}


class ValidationError(DomainError):
    """Данные не прошли проверку. `field` подсвечивает поле формы."""

    status = 422
    code = "validation_error"

    def __init__(self, detail: str, *, field: str | None = None, code: str | None = None, **extra):
        if field:
            extra["field"] = field
        super().__init__(detail, code=code, **extra)


class ConflictError(DomainError):
    """Операция противоречит текущему состоянию (например, категория не пуста)."""

    status = 409
    code = "conflict"


class NotFoundError(DomainError):
    status = 404
    code = "not_found"


class PermissionDenied(DomainError):
    status = 403
    code = "forbidden"
