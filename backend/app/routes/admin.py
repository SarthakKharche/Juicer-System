import secrets
import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ParkingSlot
from app.schemas import ParkingSlotCreate

router = APIRouter(prefix="/admin/slots", tags=["Admin Parking Slots"])

SLOT_PATTERN = re.compile(r"^[A-Z0-9_-]+$", re.IGNORECASE)

def serialize_slot(slot: ParkingSlot):
    return {
        "slot_id": slot.slot_id,
        "qr_token": slot.qr_token,
        "is_active": slot.is_active,
        "created_at": slot.created_at.isoformat() if slot.created_at else None
    }

@router.get("")
def get_slots(db: Session = Depends(get_db)):
    slots = db.query(ParkingSlot).order_by(ParkingSlot.slot_id.asc()).all()
    return [serialize_slot(s) for s in slots]

@router.post("")
def create_slot(payload: ParkingSlotCreate, db: Session = Depends(get_db)):
    # Normalize slot_id
    slot_id = payload.slot_id.strip().upper()
    if not slot_id:
        raise HTTPException(status_code=400, detail="Slot ID cannot be empty")
    
    if not SLOT_PATTERN.match(slot_id):
        raise HTTPException(
            status_code=400,
            detail="Slot ID must be alphanumeric and can include underscores or hyphens"
        )
        
    # Check if slot already exists
    existing = db.get(ParkingSlot, slot_id)
    if existing:
        raise HTTPException(status_code=400, detail=f"Parking slot '{slot_id}' already exists")
        
    # Generate secure qr token
    qr_token = secrets.token_urlsafe(32)
    
    slot = ParkingSlot(
        slot_id=slot_id,
        qr_token=qr_token,
        is_active=True
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return serialize_slot(slot)

@router.post("/{slot_id}/toggle")
def toggle_slot(slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")
        
    slot.is_active = not slot.is_active
    db.commit()
    db.refresh(slot)
    return serialize_slot(slot)

@router.post("/{slot_id}/regenerate")
def regenerate_slot_qr(slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")
        
    slot.qr_token = secrets.token_urlsafe(32)
    db.commit()
    db.refresh(slot)
    return serialize_slot(slot)

@router.delete("/{slot_id}")
def delete_slot(slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")
        
    db.delete(slot)
    db.commit()
    return {"ok": True, "message": f"Parking slot '{slot_id}' deleted successfully"}
