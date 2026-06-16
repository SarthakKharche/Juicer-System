from pydantic import BaseModel


class StartRequest(BaseModel):
    phone_number: str
    slot_id: str
    vehicle_number: str


class StopRequest(BaseModel):
    phone_number: str


class PaymentCallback(BaseModel):
    job_id: str
    transaction_id: str
    payment_status: str
    amount_paid: float
    target_kwh_limit: float


class PluggedInRequest(BaseModel):
    charger_id: str


class TelemetryRequest(BaseModel):
    charger_id: str
    job_id: str
    current_wh_delivered: float
    target_wh_limit: float


class BuildingCreate(BaseModel):
    building_name: str
    building_type: str | None = None
    address: str | None = None
    # Optional only for backward compatibility. Backend still auto-generates
    # the final unique building_id from building_name.
    building_id: str | None = None


class BuildingResponse(BaseModel):
    building_id: str
    building_name: str
    building_type: str | None = None
    address: str | None = None
    is_active: bool
    created_at: str | None = None


class ParkingSlotCreate(BaseModel):
    slot_id: str
    floor: str | None = None
    zone: str | None = None


class ParkingSlotCreateWithBuilding(ParkingSlotCreate):
    building_id: str


class ParkingSlotResponse(BaseModel):
    parking_slot_id: str
    building_id: str
    building_name: str | None = None
    building_type: str | None = None
    address: str | None = None
    slot_id: str
    floor: str | None = None
    zone: str | None = None
    qr_token: str
    qr_text: str
    qr_link: str
    is_active: bool
    created_at: str | None = None
