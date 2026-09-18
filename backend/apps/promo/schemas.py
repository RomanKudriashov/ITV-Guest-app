from __future__ import annotations

from ninja import Schema


class BannerIn(Schema):
    name: str
    title: dict | None = None
    subtitle: dict | None = None
    size: str = "m"
    placement: str = "top"
    action: str = "none"
    action_url: str = ""
    action_service_id: str | None = None
    page_title: dict | None = None
    page_body: dict | None = None
    is_active: bool = True
    starts_on: str | None = None
    ends_on: str | None = None
    time_from: str | None = None
    time_to: str | None = None
    first_visit_only: bool = False
    languages: list[str] | None = None
    room_category_ids: list[str] | None = None
    priority: int = 0


class BannerPatch(Schema):
    name: str | None = None
    title: dict | None = None
    subtitle: dict | None = None
    size: str | None = None
    placement: str | None = None
    action: str | None = None
    action_url: str | None = None
    action_service_id: str | None = None
    page_title: dict | None = None
    page_body: dict | None = None
    is_active: bool | None = None
    starts_on: str | None = None
    ends_on: str | None = None
    time_from: str | None = None
    time_to: str | None = None
    first_visit_only: bool | None = None
    languages: list[str] | None = None
    room_category_ids: list[str] | None = None
    priority: int | None = None


class BannerImageIn(Schema):
    asset_id: str
    sort_order: int = 0
