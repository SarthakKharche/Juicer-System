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

class ParkingSlotCreate(BaseModel):
    slot_id: str

class ParkingSlotResponse(BaseModel):
    slot_id: str
    qr_token: str
    is_active: bool
    created_at: str

    class Config:
        from_attributes = True

