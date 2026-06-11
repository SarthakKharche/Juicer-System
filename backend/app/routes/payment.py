from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PaymentDetails, Queue
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


@router.post("/fake-success/{job_id}")
def fake_payment_success(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    payment = PaymentDetails(
        transaction_id=f"FAKE-{uuid4()}",
        job_id=job_id,
        payment_status="SUCCESS",
        amount_paid=100.00,
        target_kwh_limit=5.00,
    )

    db.add(payment)
    job.current_step = "ASSIGNED"

    db.commit()
    db.refresh(job)

    return {
        "ok": True,
        "message": "Fake payment successful",
        "job_id": job.job_id,
        "current_step": job.current_step,
        "amount_paid": 100.00,
        "target_kwh_limit": 5.00,
    }