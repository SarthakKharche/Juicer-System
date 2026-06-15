import re

from fastapi import APIRouter, Request, Depends, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Queue, ChargeStatus, ParkingSlot
from app.services.whatsapp_service import send_whatsapp_text, send_payment_button
from app.services.queue_service import create_or_update_request, get_latest_job_by_phone

router = APIRouter(prefix="/webhooks/whatsapp", tags=["WhatsApp"])

pending_slots: dict[str, str] = {}

VEHICLE_NUMBER_PATTERN = re.compile(
    r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$"
)

SLOT_PATTERN = re.compile(
    r"^[A-Z][0-9]+$"
)


def normalize_command(value: str) -> str:
    return value.strip().lower()


def normalize_vehicle_number(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


def is_valid_vehicle_number(value: str) -> bool:
    return bool(VEHICLE_NUMBER_PATTERN.match(value))


def normalize_slot_id(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


def is_valid_slot_id(value: str) -> bool:
    return bool(SLOT_PATTERN.match(value))


def get_queue_position(db: Session, job: Queue):
    active_jobs = (
        db.query(Queue)
        .filter(Queue.current_step.in_(["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]))
        .order_by(Queue.created_at.asc())
        .all()
    )

    for index, item in enumerate(active_jobs, start=1):
        if item.job_id == job.job_id:
            return index, len(active_jobs)

    return None, len(active_jobs)


def get_energy_kwh(db: Session, job_id: str) -> float:
    charge_status = (
        db.query(ChargeStatus)
        .filter(ChargeStatus.job_id == job_id)
        .first()
    )

    if not charge_status:
        return 0.0

    current_wh = float(charge_status.current_wh_delivered or 0)
    return current_wh / 1000


@router.get("")
async def verify_webhook(request: Request):
    params = request.query_params

    if (
        params.get("hub.mode") == "subscribe"
        and params.get("hub.verify_token") == settings.VERIFY_TOKEN
    ):
        return Response(
            content=params.get("hub.challenge"),
            media_type="text/plain",
        )

    return Response(status_code=403)


@router.post("")
async def receive_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    body = await request.json()
    print("Webhook received:", body)

    value = body.get("entry", [{}])[0].get("changes", [{}])[0].get("value", {})
    message = (value.get("messages") or [None])[0]

    if not message:
        return {"ok": True}

    phone = message.get("from")
    text = (message.get("text") or {}).get("body", "").strip()
    command = normalize_command(text)

    interactive = message.get("interactive")

    if interactive:
        button_reply = interactive.get("button_reply")

        if button_reply:
            button_id = button_reply.get("id", "")

            if button_id.startswith("fake_pay:"):
                job_id = button_id.split("fake_pay:")[1]
                job = db.get(Queue, job_id)

                if not job:
                    send_whatsapp_text(phone, "Payment failed. Job not found.")
                    return {"ok": True}

                if job.current_step != "INITIATED":
                    send_whatsapp_text(
                        phone,
                        f"Payment is already processed or not required.\n"
                        f"Current status: {job.current_step}",
                    )
                    return {"ok": True}

                job.current_step = "ASSIGNED"
                db.commit()
                db.refresh(job)

                position, total = get_queue_position(db, job)

                send_whatsapp_text(
                    phone,
                    "Payment successful ✅\n\n"
                    f"Job ID: {job.job_id}\n"
                    f"Status: {job.current_step}\n"
                    f"Queue Position: #{position} of {total}\n\n"
                    "Type STATUS anytime to check live queue and charging status.\n"
                    "Type STOP to request stop charging.\n\n"
                    "A Juicer operator will serve requests first come, first serve.",
                )

                return {"ok": True}

            if button_id.startswith("check_status:"):
                job_id = button_id.split("check_status:")[1]
                job = db.get(Queue, job_id)

                if not job:
                    send_whatsapp_text(phone, "Status not found. Job does not exist.")
                    return {"ok": True}

                energy_kwh = get_energy_kwh(db, job.job_id)
                position, total = get_queue_position(db, job)

                queue_line = ""
                if job.current_step in ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]:
                    queue_line = f"Queue Position: #{position} of {total}\n"

                send_whatsapp_text(
                    phone,
                    "Live Charging Status ⚡\n\n"
                    f"Status: {job.current_step}\n"
                    f"{queue_line}"
                    f"Slot: {job.slot_id}\n"
                    f"Vehicle: {job.vehicle_number}\n"
                    f"Energy Used: {energy_kwh:.2f} kWh\n\n"
                    "Type STATUS anytime for live status.\n"
                    "Type STOP to request stop charging.",
                )

                return {"ok": True}

    if not phone or not text:
        return {"ok": True}

    if command in ["hi", "hello", "start"]:
        send_whatsapp_text(
            phone,
            "Welcome to Juicer EV Charging ⚡\n\n"
            "Scan a parking QR or send:\n"
            "Charge_Request_Slot_<slot>\n\n"
            "Example:\n"
            "Charge_Request_Slot_S4",
        )
        return {"ok": True}

    if command in ["status", "live status", "check status", "vehicle status"]:
        job = get_latest_job_by_phone(db, phone)

        if not job:
            send_whatsapp_text(phone, "No active charging request found.")
            return {"ok": True}

        position, total = get_queue_position(db, job)
        energy_kwh = get_energy_kwh(db, job.job_id)

        if job.current_step == "INITIATED":
            message_text = (
                "Your charging request is created ✅\n\n"
                "Status: Payment Pending\n"
                f"Job ID: {job.job_id}\n"
                f"Slot: {job.slot_id}\n"
                f"Vehicle: {job.vehicle_number or 'Pending'}\n\n"
                "Please complete payment to join the queue."
            )

        elif job.current_step in ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]:
            message_text = (
                "Your Juicer request status ⚡\n\n"
                f"Status: {job.current_step}\n"
                f"Job ID: {job.job_id}\n"
                f"Queue Position: #{position} of {total}\n"
                f"Slot: {job.slot_id}\n"
                f"Vehicle: {job.vehicle_number or 'Pending'}\n"
                f"Energy Used: {energy_kwh:.2f} kWh\n\n"
                "Type STATUS anytime for live status.\n"
                "Type STOP to request stop charging."
            )

        else:
            message_text = (
                "Your charging session is completed ✅\n\n"
                f"Status: {job.current_step}\n"
                f"Job ID: {job.job_id}\n"
                f"Slot: {job.slot_id}\n"
                f"Vehicle: {job.vehicle_number or 'Pending'}\n"
                f"Energy Used: {energy_kwh:.2f} kWh"
            )

        send_whatsapp_text(phone, message_text)
        return {"ok": True}

    if command in ["stop", "stop charging", "end", "end charging"]:
        job = get_latest_job_by_phone(db, phone)

        if not job:
            send_whatsapp_text(phone, "No active charging session found.")
            return {"ok": True}

        if job.current_step == "CHARGING":
            job.current_step = "STOP_REQUESTED"

            charge_status = (
                db.query(ChargeStatus)
                .filter(ChargeStatus.job_id == job.job_id)
                .first()
            )

            if charge_status:
                charge_status.is_charging_active = False

            db.commit()
            db.refresh(job)

            send_whatsapp_text(
                phone,
                "Charging stop request received 🛑\n\n"
                "Charging will be stopped immediately by the Juicer operator.\n"
                "Type STATUS anytime to check the latest session status.",
            )

        elif job.current_step == "STOP_REQUESTED":
            send_whatsapp_text(
                phone,
                "Stop request is already active 🛑\n\n"
                "The Juicer operator has been notified.",
            )

        else:
            send_whatsapp_text(
                phone,
                f"Stop is only available while charging.\n"
                f"Current status: {job.current_step}",
            )

        return {"ok": True}

    if text.startswith("Charge_Request_Slot_"):
        raw_slot_id = text.replace("Charge_Request_Slot_", "").strip()
        
        # Check if raw_slot_id is a secure qr_token
        slot_record = db.query(ParkingSlot).filter(ParkingSlot.qr_token == raw_slot_id).first()
        
        if slot_record:
            if not slot_record.is_active:
                send_whatsapp_text(
                    phone,
                    "This parking slot QR code has been deactivated ❌\n\n"
                    "Please contact the admin.",
                )
                return {"ok": True}
            slot_id = slot_record.slot_id
        else:
            # Fallback for slot_id matching directly
            slot_id = normalize_slot_id(raw_slot_id)
            # Check if this slot exists in our DB
            db_slot = db.query(ParkingSlot).filter(ParkingSlot.slot_id == slot_id).first()
            if db_slot:
                if not db_slot.is_active:
                    send_whatsapp_text(
                        phone,
                        "This parking slot QR code has been deactivated ❌\n\n"
                        "Please contact the admin.",
                    )
                    return {"ok": True}
            elif not is_valid_slot_id(slot_id):
                # If it doesn't exist in our DB and is not a valid format
                send_whatsapp_text(
                    phone,
                    "Invalid slot ID or QR code format ❌\n\n"
                    "Please scan a valid QR or send:\n"
                    "Charge_Request_Slot_S4",
                )
                return {"ok": True}

        pending_slots[phone] = slot_id

        send_whatsapp_text(
            phone,
            f"Slot {slot_id} received.\n\n"
            "Please send your vehicle number.\n"
            "Example: MH12AB1234",
        )
        return {"ok": True}

    if phone in pending_slots:
        slot_id = pending_slots.pop(phone)
        vehicle_number = normalize_vehicle_number(text)

        if not is_valid_vehicle_number(vehicle_number):
            pending_slots[phone] = slot_id

            send_whatsapp_text(
                phone,
                "Invalid vehicle number format ❌\n\n"
                "Please send a valid Indian vehicle number.\n"
                "Example: MH12AB1234",
            )

            return {"ok": True}

        job = create_or_update_request(
            db,
            phone,
            slot_id,
            vehicle_number,
        )

        send_payment_button(phone, job.job_id)

        return {"ok": True}

    send_whatsapp_text(
        phone,
        "Sorry, I did not understand.\n\n"
        "Send 'hi', 'status', 'stop', or scan a Juicer QR code.",
    )

    return {"ok": True}