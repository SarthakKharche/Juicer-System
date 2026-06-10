from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Queue
from app.schemas import PluggedInRequest
from app.services.queue_service import update_job_step

router = APIRouter(prefix="/juicer", tags=["Juicer"])

@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db)):
    jobs = db.query(Queue).order_by(Queue.updated_at.desc()).limit(50).all()
    return [{"job_id": j.job_id, "slot_id": j.slot_id, "phone_number": j.phone_number, "vehicle_number": j.vehicle_number, "current_step": j.current_step} for j in jobs]

@router.post("/jobs/{job_id}/accept")
def accept_job(job_id: str, db: Session = Depends(get_db)):
    job = update_job_step(db, job_id, "ASSIGNED")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "current_step": job.current_step}

@router.post("/jobs/{job_id}/plugged-in")
def plugged_in(job_id: str, payload: PluggedInRequest, db: Session = Depends(get_db)):
    job = update_job_step(db, job_id, "CHARGING")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "charger_id": payload.charger_id, "current_step": job.current_step}

@router.post("/jobs/{job_id}/complete")
def complete_job(job_id: str, db: Session = Depends(get_db)):
    job = update_job_step(db, job_id, "COMPLETED")
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "current_step": job.current_step}
