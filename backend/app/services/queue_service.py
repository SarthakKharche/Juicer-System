from uuid import uuid4
from sqlalchemy.orm import Session
from app.models import CustomerDetails, Queue


def create_or_update_request(
    db: Session,
    phone_number: str,
    slot_id: str,
    vehicle_number: str,
    building_id: str | None = None,
    parking_slot_id: str | None = None,
) -> Queue:
    customer = db.get(CustomerDetails, phone_number)
    if not customer:
        customer = CustomerDetails(
            customer_id=phone_number,
            phone_number=phone_number,
            vehicle_number=vehicle_number,
        )
        db.add(customer)
    else:
        customer.vehicle_number = vehicle_number

    job = Queue(
        job_id=str(uuid4()),
        slot_id=slot_id,
        building_id=building_id,
        parking_slot_id=parking_slot_id,
        phone_number=phone_number,
        vehicle_number=vehicle_number,
        current_step="INITIATED",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_latest_job_by_phone(db: Session, phone_number: str) -> Queue | None:
    return (
        db.query(Queue)
        .filter(Queue.phone_number == phone_number)
        .order_by(Queue.updated_at.desc())
        .first()
    )


def update_job_step(db: Session, job_id: str, step: str) -> Queue | None:
    job = db.get(Queue, job_id)
    if not job:
        return None
    job.current_step = step
    db.commit()
    db.refresh(job)
    return job
