from sqlalchemy import String, Boolean, Numeric, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from app.database import Base


class CustomerDetails(Base):
    __tablename__ = "customer_details"

    customer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    vehicle_number: Mapped[str] = mapped_column(String(32), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())


class Queue(Base):
    __tablename__ = "queue"

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slot_id: Mapped[str] = mapped_column(String(16), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(24), nullable=False)
    vehicle_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    current_step: Mapped[str] = mapped_column(String(32), nullable=False, default="INITIATED")

    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now()
    )


class PaymentDetails(Base):
    __tablename__ = "payment_details"

    transaction_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), ForeignKey("queue.job_id"), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_paid: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    target_kwh_limit: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)


class ChargeStatus(Base):
    __tablename__ = "charge_status"

    active_charger_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    job_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("queue.job_id"), nullable=True)
    current_wh_delivered: Mapped[float] = mapped_column(Numeric(8, 2), default=0.00)
    is_charging_active: Mapped[bool] = mapped_column(Boolean, default=False)
    last_pulse_at: Mapped[DateTime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now()
    )