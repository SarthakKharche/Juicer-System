from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Queue, ChargeStatus, Building, ParkingSlot
from app.schemas import PluggedInRequest
from app.services.whatsapp_service import (
    send_status_button,
    send_whatsapp_text,
)

router = APIRouter(prefix="/juicer", tags=["Juicer"])

ACTIVE_STEPS = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]
CHECK = "\u2705"
LIGHTNING = "\u26a1"


def serialize_job(job: Queue, db: Session | None = None):
    building = None
    parking_slot = None
    energy_kwh = 0.0
    active_steps = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]

    if db and getattr(job, "building_id", None):
        building = db.get(Building, job.building_id)

    if db and getattr(job, "parking_slot_id", None):
        parking_slot = db.get(ParkingSlot, job.parking_slot_id)

    if db:
        charge_status_rows = []
        slot_status = db.get(ChargeStatus, job.slot_id) if job.current_step in active_steps else None
        if slot_status and slot_status.job_id == job.job_id:
            charge_status_rows.append(slot_status)

        charge_status_rows.extend(
            db.query(ChargeStatus)
            .filter(ChargeStatus.job_id == job.job_id)
            .order_by(ChargeStatus.last_pulse_at.desc())
            .all()
        )

        if charge_status_rows:
            energy_wh = max(float(status.current_wh_delivered or 0) for status in charge_status_rows)
            energy_kwh = energy_wh / 1000

    return {
        "job_id": job.job_id,
        "slot_id": job.slot_id,
        "building_id": job.building_id,
        "building_name": building.building_name if building else None,
        "building_type": building.building_type if building else None,
        "parking_slot_id": job.parking_slot_id,
        "floor": parking_slot.floor if parking_slot else None,
        "zone": parking_slot.zone if parking_slot else None,
        "phone_number": job.phone_number,
        "vehicle_number": job.vehicle_number,
        "current_step": job.current_step,
        "energy_kwh": energy_kwh,
        "cost": energy_kwh * 15.0,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }

@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db)):
    jobs = (
        db.query(Queue)
        .filter(Queue.current_step.in_(ACTIVE_STEPS))
        .order_by(Queue.created_at.asc())
        .limit(100)
        .all()
    )

    return [serialize_job(job, db) for job in jobs]


@router.get("/jobs/all")
def get_all_jobs(db: Session = Depends(get_db)):
    jobs = (
        db.query(Queue)
        .order_by(Queue.created_at.asc())
        .limit(100)
        .all()
    )

    return [serialize_job(job, db) for job in jobs]


@router.post("/jobs/{job_id}/accept")
def accept_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step != "ASSIGNED":
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be accepted from status {job.current_step}",
        )

    active_job = (
        db.query(Queue)
        .filter(Queue.current_step.in_(["ENROUTE", "CHARGING", "STOP_REQUESTED"]))
        .first()
    )

    if active_job:
        raise HTTPException(
            status_code=400,
            detail="Another job is already active. Complete it before accepting a new job.",
        )

    first_assigned_job = (
        db.query(Queue)
        .filter(Queue.current_step == "ASSIGNED")
        .order_by(Queue.created_at.asc())
        .first()
    )

    if first_assigned_job and first_assigned_job.job_id != job.job_id:
        raise HTTPException(
            status_code=400,
            detail="Only the first job in the queue can be accepted.",
        )

    job.current_step = "ENROUTE"
    db.commit()
    db.refresh(job)

    return {
        "ok": True,
        "job_id": job.job_id,
        "current_step": job.current_step,
    }


@router.post("/jobs/{job_id}/plugged-in")
def plugged_in(
    job_id: str,
    payload: PluggedInRequest,
    db: Session = Depends(get_db),
):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step != "ENROUTE":
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be plugged in from status {job.current_step}",
        )

    job.current_step = "CHARGING"

    charge_status = db.get(ChargeStatus, payload.charger_id)

    if not charge_status:
        charge_status = ChargeStatus(
            active_charger_id=payload.charger_id,
            job_id=job.job_id,
            current_wh_delivered=0,
            is_charging_active=True,
        )
        db.add(charge_status)
    else:
        charge_status.job_id = job.job_id
        charge_status.current_wh_delivered = 0
        charge_status.is_charging_active = True

    db.commit()
    db.refresh(job)

    send_status_button(job.phone_number, job.job_id)

    return {
        "ok": True,
        "job_id": job.job_id,
        "charger_id": payload.charger_id,
        "current_step": job.current_step,
    }


@router.post("/jobs/{job_id}/complete")
def complete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Queue, job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_step not in ["CHARGING", "STOP_REQUESTED"]:
        raise HTTPException(
            status_code=400,
            detail=f"Job cannot be completed from status {job.current_step}",
        )

    charge_status = (
        db.query(ChargeStatus)
        .filter(ChargeStatus.job_id == job.job_id)
        .first()
    )

    energy_kwh = 0.0

    if charge_status:
        energy_kwh = float(charge_status.current_wh_delivered or 0) / 1000
        charge_status.is_charging_active = False

    job.current_step = "COMPLETED"

    db.commit()
    db.refresh(job)

    send_whatsapp_text(
        job.phone_number,
        f"Charging completed {CHECK}\n\n"
        f"Vehicle: {job.vehicle_number}\n"
        f"Slot: {job.slot_id}\n"
        f"Energy Delivered: {energy_kwh:.2f} kWh\n\n"
        f"Thank you for using Juicer {LIGHTNING}",
    )

    return {
        "ok": True,
        "job_id": job.job_id,
        "current_step": job.current_step,
        "energy_kwh": energy_kwh,
    }
