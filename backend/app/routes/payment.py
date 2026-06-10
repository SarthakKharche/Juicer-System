from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import PaymentDetails
from app.schemas import PaymentCallback
from app.services.queue_service import update_job_step

router = APIRouter(prefix="/payment", tags=["Payment"])

@router.post("/callback")
def payment_callback(payload: PaymentCallback, db: Session = Depends(get_db)):
    payment = PaymentDetails(
        transaction_id=payload.transaction_id,
        job_id=payload.job_id,
        payment_status=payload.payment_status,
        amount_paid=payload.amount_paid,
        target_kwh_limit=payload.target_kwh_limit,
    )
    db.add(payment)
    if payload.payment_status.upper() == "SUCCESS":
        update_job_step(db, payload.job_id, "ASSIGNED")
    db.commit()
    return {"ok": True}
