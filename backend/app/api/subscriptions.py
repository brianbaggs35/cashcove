"""Create, track and manage subscriptions: services paid for on a schedule."""

from app.api.recurring import recurring_router
from app.models import RecurringKind

router = recurring_router(RecurringKind.SUBSCRIPTION)
