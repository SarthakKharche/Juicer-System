from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Queue
from app.schemas import PluggedInRequest
from app.services.queue_service import update_job_step

router = APIRouter(prefix="/juicer", tags=["Juicer"])


@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db)):
    jobs = db.query(Queue).order_by(Queue.updated_at.desc()).limit(100).all()

    return [
        {
            "job_id": job.job_id,
            "slot_id": job.slot_id,
            "phone_number": job.phone_number,
            "vehicle_number": job.vehicle_number,
            "current_step": job.current_step,
        }
        for job in jobs
    ]


@router.get("/jobs/active")
def get_active_jobs(db: Session = Depends(get_db)):
    jobs = (
        db.query(Queue)
        .filter(Queue.current_step.in_(["ASSIGNED", "ENROUTE", "CHARGING"]))
        .order_by(Queue.updated_at.desc())
        .all()
    )

    return [
        {
            "job_id": job.job_id,
            "slot_id": job.slot_id,
            "phone_number": job.phone_number,
            "vehicle_number": job.vehicle_number,
            "current_step": job.current_step,
        }
        for job in jobs
    ]


@router.post("/jobs/{job_id}/accept")
def accept_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step != "ASSIGNED":
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be accepted from status {job.current_step}"
        )

    job.current_step = "ENROUTE"
    db.commit()
    db.refresh(job)

    return {
        "ok": True,
        "job_id": job.job_id,
        "current_step": job.current_step
    }


@router.post("/jobs/{job_id}/plugged-in")
def plugged_in(
    job_id: str,
    payload: PluggedInRequest,
    db: Session = Depends(get_db)
):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step != "ENROUTE":
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be plugged in from status {job.current_step}"
        )

    job.current_step = "CHARGING"
    db.commit()
    db.refresh(job)

    return {
        "ok": True,
        "job_id": job.job_id,
        "charger_id": payload.charger_id,
        "current_step": job.current_step
    }


@router.post("/jobs/{job_id}/complete")
def complete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step != "CHARGING":
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be completed from status {job.current_step}"
        )

    job.current_step = "COMPLETED"
    db.commit()
    db.refresh(job)

    return {
        "ok": True,
        "job_id": job.job_id,
        "current_step": job.current_step
    }