"""Сборка эндпоинтов заявок: гость, персонал, трекер."""

from __future__ import annotations


from .guest import orders as guest_orders
from .staff import orders as staff_orders
from .staff import tracker as staff_tracker

guest_router = guest_orders.router
staff_router = staff_orders.router
tracker_router = staff_tracker.router

__all__ = ["guest_router", "staff_router", "tracker_router"]
