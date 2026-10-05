"""Create, track and manage bills: what is owed to a provider on a schedule, like electricity."""

from app.api.recurring import recurring_router
from app.models import RecurringKind

router = recurring_router(RecurringKind.BILL)
