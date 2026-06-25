import re
import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Building, ParkingSlot
from app.schemas import BuildingCreate, ParkingSlotCreate, ParkingSlotCreateWithBuilding

router = APIRouter(prefix="/admin", tags=["Admin QR Management"])

SAFE_ID_PATTERN = re.compile(r"^[A-Z0-9_-]+$", re.IGNORECASE)


def normalize_id(value: str) -> str:
    return value.strip().upper().replace(" ", "_")


def validate_id(label: str, value: str) -> str:
    clean_value = normalize_id(value)
    if not clean_value:
        raise HTTPException(status_code=400, detail=f"{label} cannot be empty")
    if not SAFE_ID_PATTERN.match(clean_value):
        raise HTTPException(
            status_code=400,
            detail=f"{label} must be alphanumeric and can include underscores or hyphens",
        )
    return clean_value


def generate_building_id_from_name(building_name: str, db: Session) -> str:
    """
    Building ID is system-generated from building_name.
    If another building already has the same generated ID, append _2, _3, etc.
    This keeps building IDs locked in the admin UI and globally unique in DB.
    """

    base = re.sub(r"[^A-Z0-9]+", "_", building_name.strip().upper()).strip("_")

    if not base:
        raise HTTPException(status_code=400, detail="Building name cannot be empty")

    base = base[:28]
    candidate = base
    counter = 2

    while db.get(Building, candidate):
        suffix = f"_{counter}"
        candidate = f"{base[:32 - len(suffix)]}{suffix}"
        counter += 1

    return candidate


def make_parking_slot_id(building_id: str, slot_id: str) -> str:
    return f"{building_id}__{slot_id}"


def make_qr_text(qr_token: str) -> str:
    return f"Charge_Request_Slot_{qr_token}"


def make_qr_link(qr_token: str) -> str:
    # Primary QR flow remains token-based so users cannot change the slot by editing text.
    qr_text = make_qr_text(qr_token)
    return f"https://wa.me/{settings.WHATSAPP_BOT_NUMBER}?text={quote(qr_text)}"


def make_manual_text(building_id: str, slot_id: str) -> str:
    # Manual fallback format requested for cases where QR cannot be scanned.
    return f"Charge_Request_Building_{building_id}_Slot_{slot_id}"


def make_manual_link(building_id: str, slot_id: str) -> str:
    manual_text = make_manual_text(building_id, slot_id)
    return f"https://wa.me/{settings.WHATSAPP_BOT_NUMBER}?text={quote(manual_text)}"


def serialize_building(building: Building):
    return {
        "building_id": building.building_id,
        "building_name": building.building_name,
        "building_type": building.building_type,
        "address": building.address,
        "is_active": building.is_active,
        "created_at": building.created_at.isoformat() if building.created_at else None,
    }


def serialize_slot(slot: ParkingSlot, building: Building | None = None):
    return {
        "parking_slot_id": slot.parking_slot_id,
        "building_id": slot.building_id,
        "building_name": building.building_name if building else None,
        "building_type": building.building_type if building else None,
        "address": building.address if building else None,
        "slot_id": slot.slot_id,
        "floor": slot.floor,
        "zone": slot.zone,
        "qr_token": slot.qr_token,
        "qr_text": make_qr_text(slot.qr_token),
        "qr_link": make_qr_link(slot.qr_token),
        "manual_text": make_manual_text(slot.building_id, slot.slot_id),
        "manual_link": make_manual_link(slot.building_id, slot.slot_id),
        "is_active": slot.is_active,
        "created_at": slot.created_at.isoformat() if slot.created_at else None,
    }


@router.get("/buildings")
def get_buildings(db: Session = Depends(get_db)):
    buildings = db.query(Building).order_by(Building.building_name.asc()).all()
    return [serialize_building(building) for building in buildings]


@router.post("/buildings")
def create_building(payload: BuildingCreate, db: Session = Depends(get_db)):
    building_name = payload.building_name.strip()

    if not building_name:
        raise HTTPException(status_code=400, detail="Building name cannot be empty")

    building_id = generate_building_id_from_name(building_name, db)

    building = Building(
        building_id=building_id,
        building_name=building_name,
        building_type=payload.building_type.strip() if payload.building_type else None,
        address=payload.address.strip() if payload.address else None,
        is_active=True,
    )

    db.add(building)
    db.commit()
    db.refresh(building)

    return serialize_building(building)


@router.post("/buildings/{building_id}/toggle")
def toggle_building(building_id: str, db: Session = Depends(get_db)):
    building = db.get(Building, normalize_id(building_id))
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    building.is_active = not building.is_active
    db.commit()
    db.refresh(building)
    return serialize_building(building)


@router.delete("/buildings/{building_id}")
def delete_building(building_id: str, db: Session = Depends(get_db)):
    building_id = normalize_id(building_id)
    building = db.get(Building, building_id)
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    slots_count = db.query(ParkingSlot).filter(ParkingSlot.building_id == building_id).count()
    if slots_count:
        raise HTTPException(
            status_code=400,
            detail="Delete this building's parking slots first",
        )

    db.delete(building)
    db.commit()
    return {"ok": True, "message": f"Building '{building_id}' deleted successfully"}


@router.get("/slots")
def get_all_slots(db: Session = Depends(get_db)):
    rows = (
        db.query(ParkingSlot, Building)
        .join(Building, ParkingSlot.building_id == Building.building_id)
        .order_by(Building.building_name.asc(), ParkingSlot.slot_id.asc())
        .all()
    )
    return [serialize_slot(slot, building) for slot, building in rows]


@router.post("/slots")
def create_slot_direct(payload: ParkingSlotCreateWithBuilding, db: Session = Depends(get_db)):
    return create_slot_for_building(payload.building_id, payload, db)


@router.get("/buildings/{building_id}/slots")
def get_slots_for_building(building_id: str, db: Session = Depends(get_db)):
    building_id = normalize_id(building_id)
    building = db.get(Building, building_id)
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    slots = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.building_id == building_id)
        .order_by(ParkingSlot.slot_id.asc())
        .all()
    )
    return [serialize_slot(slot, building) for slot in slots]


@router.post("/buildings/{building_id}/slots")
def create_slot_for_building(
    building_id: str,
    payload: ParkingSlotCreate,
    db: Session = Depends(get_db),
):
    building_id = validate_id("Building ID", building_id)
    slot_id = validate_id("Slot ID", payload.slot_id)

    building = db.get(Building, building_id)
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    if not building.is_active:
        raise HTTPException(status_code=400, detail="Building is inactive")

    existing = (
        db.query(ParkingSlot)
        .filter(ParkingSlot.building_id == building_id, ParkingSlot.slot_id == slot_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Slot '{slot_id}' already exists in building '{building_id}'",
        )

    slot = ParkingSlot(
        parking_slot_id=make_parking_slot_id(building_id, slot_id),
        building_id=building_id,
        slot_id=slot_id,
        floor=payload.floor.strip() if payload.floor else None,
        zone=payload.zone.strip() if payload.zone else None,
        qr_token=secrets.token_urlsafe(32),
        is_active=True,
    )

    db.add(slot)
    db.commit()
    db.refresh(slot)

    return serialize_slot(slot, building)


@router.post("/slots/{parking_slot_id}/toggle")
def toggle_slot(parking_slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, parking_slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")

    building = db.get(Building, slot.building_id)
    slot.is_active = not slot.is_active
    db.commit()
    db.refresh(slot)
    return serialize_slot(slot, building)


@router.post("/slots/{parking_slot_id}/regenerate")
def regenerate_slot_qr(parking_slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, parking_slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")

    building = db.get(Building, slot.building_id)
    slot.qr_token = secrets.token_urlsafe(32)
    slot.is_active = True
    db.commit()
    db.refresh(slot)
    return serialize_slot(slot, building)


@router.delete("/slots/{parking_slot_id}")
def delete_slot(parking_slot_id: str, db: Session = Depends(get_db)):
    slot = db.get(ParkingSlot, parking_slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Parking slot not found")

    display = f"{slot.building_id}/{slot.slot_id}"
    db.delete(slot)
    db.commit()
    return {"ok": True, "message": f"Parking slot '{display}' deleted successfully"}
