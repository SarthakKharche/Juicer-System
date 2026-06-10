from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import StartRequest, StopRequest
from app.services.queue_service import create_or_update_request, get_latest_job_by_phone

router = APIRouter(prefix="/customer", tags=["Customer"])

@router.post("/start-request")
def start_request(payload: StartRequest, db: Session = Depends(get_db)):
    job = create_or_update_request(db, payload.phone_number, payload.slot_id, payload.vehicle_number)
    return {"job_id": job.job_id, "status": job.current_step}

@router.get("/status/{phone_number}")
def get_status(phone_number: str, db: Session = Depends(get_db)):
    job = get_latest_job_by_phone(db, phone_number)
    if not job:
        return {"found": False}
    return {"found": True, "job_id": job.job_id, "slot_id": job.slot_id, "vehicle_number": job.vehicle_number, "current_step": job.current_step}

@router.post("/stop")
def stop_request(payload: StopRequest):
    return {"ok": True, "message": "Stop request received", "phone_number": payload.phone_number}
