from datetime import datetime

from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.models import Base, TimestampMixin


class Widget(TimestampMixin, Base):
    __tablename__ = "test_widget"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]


WIDGET_TABLE: Table = Base.metadata.tables["test_widget"]


def test_timestamp_mixin_sets_created_and_updated() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[WIDGET_TABLE])
    with Session(engine) as session:
        session.add(Widget(name="first"))
        session.commit()
        widget = session.scalars(select(Widget)).one()
        assert isinstance(widget.created_at, datetime)
        assert isinstance(widget.updated_at, datetime)
    engine.dispose()


def test_naming_convention_names_primary_keys() -> None:
    assert WIDGET_TABLE.primary_key.name == "pk_test_widget"
