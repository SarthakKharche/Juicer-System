from fastapi import APIRouter, Request, Depends, Response
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.services.whatsapp_service import send_whatsapp_text
from app.services.queue_service import create_or_update_request, get_latest_job_by_phone

router = APIRouter(prefix="/webhooks/whatsapp", tags=["WhatsApp"])
pending_slots: dict[str, str] = {}

@router.get("")
async def verify_webhook(request: Request):
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == settings.VERIFY_TOKEN:
        return Response(content=params.get("hub.challenge"), media_type="text/plain")
    return Response(status_code=403)

@router.post("")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    print("Webhook received:", body)

    value = body.get("entry", [{}])[0].get("changes", [{}])[0].get("value", {})
    message = (value.get("messages") or [None])[0]
    if not message:
        return {"ok": True}

    phone = message.get("from")
    text = (message.get("text") or {}).get("body", "").strip()
    if not phone or not text:
        return {"ok": True}

    lower_text = text.lower()

    if lower_text in ["hi", "hello", "start"]:
        send_whatsapp_text(phone, "Welcome to Juicer EV Charging. Scan a parking QR or send Charge_Request_Slot_<slot>. Example: Charge_Request_Slot_B4")
        return {"ok": True}

    if lower_text == "status":
        job = get_latest_job_by_phone(db, phone)
        if not job:
            send_whatsapp_text(phone, "No active charging request found.")
        else:
            send_whatsapp_text(phone, f"Status: {job.current_step}\nSlot: {job.slot_id}\nVehicle: {job.vehicle_number or 'Pending'}")
        return {"ok": True}

    if lower_text == "stop":
        send_whatsapp_text(phone, "Stop request received. If charging is active, our backend will stop the session.")
        return {"ok": True}

    if text.startswith("Charge_Request_Slot_"):
        slot_id = text.replace("Charge_Request_Slot_", "").strip()
        pending_slots[phone] = slot_id
        send_whatsapp_text(phone, f"Slot {slot_id} received. Please send your vehicle number. Example: MH12AB1234")
        return {"ok": True}

    if phone in pending_slots:
        slot_id = pending_slots.pop(phone)
        vehicle_number = text.upper().replace(" ", "")
        job = create_or_update_request(db, phone, slot_id, vehicle_number)
        send_whatsapp_text(phone, f"Charging request created. Job ID: {job.job_id}\nPayment link will be shared shortly.")
        return {"ok": True}

    send_whatsapp_text(phone, "Sorry, I did not understand. Send 'hi', 'status', or scan a Juicer QR code.")
    return {"ok": True}
