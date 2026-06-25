import re
from uuid import uuid4

from fastapi import APIRouter, Request, Depends, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Queue, ChargeStatus, Building, ParkingSlot, PaymentDetails
from app.services.whatsapp_service import send_whatsapp_text, send_payment_button
from app.services.charger_service import get_active_transaction, send_remote_stop_transaction
from app.services.queue_service import create_or_update_request, get_latest_job_by_phone

router = APIRouter(prefix="/webhooks/whatsapp", tags=["WhatsApp"])

# phone -> resolved parking slot context
pending_slots: dict[str, dict[str, str]] = {}

VEHICLE_NUMBER_PATTERN = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$")
BUILDING_SLOT_PATTERN = re.compile(
    r"^Charge_Request_Building_(?P<building_id>.+)_Slot_(?P<slot_id>[^_\s]+)$",
    re.IGNORECASE,
)
ACTIVE_STEPS = ["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]
CHECK = "\u2705"
CROSS = "\u274c"
LIGHTNING = "\u26a1"
STOP_SIGN = "\U0001f6d1"


def normalize_command(value: str) -> str:
    return value.strip().lower()


def normalize_vehicle_number(value: str) -> str:
    return value.upper().replace(" ", "").replace("-", "")


def is_valid_vehicle_number(value: str) -> bool:
    return bool(VEHICLE_NUMBER_PATTERN.match(value))


def normalize_id(value: str) -> str:
    return value.strip().upper().replace(" ", "_")


def get_queue_position(db: Session, job: Queue):
    active_jobs = (
        db.query(Queue)
        .filter(Queue.current_step.in_(ACTIVE_STEPS))
        .order_by(Queue.created_at.asc())
        .all()
    )

    for index, item in enumerate(active_jobs, start=1):
        if item.job_id == job.job_id:
            return index, len(active_jobs)

    return None, len(active_jobs)


def get_energy_kwh(db: Session, job_id: str) -> float:
    job = db.get(Queue, job_id)
    charge_status_rows = []

    if job:
        slot_status = db.get(ChargeStatus, job.slot_id)
        if slot_status:
            charge_status_rows.append(slot_status)

    charge_status_rows.extend(
        db.query(ChargeStatus)
        .filter(ChargeStatus.job_id == job_id)
        .order_by(ChargeStatus.last_pulse_at.desc())
        .all()
    )

    if not charge_status_rows:
        return 0.0

    current_wh = max(float(status.current_wh_delivered or 0) for status in charge_status_rows)
    return current_wh / 1000


def get_building_name(db: Session, building_id: str | None) -> str | None:
    if not building_id:
        return None
    building = db.get(Building, building_id)
    return building.building_name if building else building_id


def format_job_location(db: Session, job: Queue) -> str:
    building_name = get_building_name(db, getattr(job, "building_id", None))
    if building_name:
        return f"Building: {building_name}\nSlot: {job.slot_id}"
    return f"Slot: {job.slot_id}"


def find_slot_by_token(db: Session, qr_token: str) -> ParkingSlot | None:
    return db.query(ParkingSlot).filter(ParkingSlot.qr_token == qr_token).first()


def find_slot_by_building_and_slot(db: Session, building_id: str, slot_id: str) -> ParkingSlot | None:
    return (
        db.query(ParkingSlot)
        .filter(
            ParkingSlot.building_id == normalize_id(building_id),
            ParkingSlot.slot_id == normalize_id(slot_id),
        )
        .first()
    )


def resolve_slot_from_message(db: Session, text: str) -> tuple[ParkingSlot | None, str]:
    """
    Supported formats:
    1. Secure QR token format:
       Charge_Request_Slot_<qr_token>

    2. Manual fallback format:
       Charge_Request_Building_MANTRA_MOMENTS_Slot_I41

    Plain slot-only manual commands are rejected because the same slot can exist
    in multiple buildings.
    """
    message_text = text.strip()

    manual_match = BUILDING_SLOT_PATTERN.match(message_text)
    if manual_match:
        building_id = manual_match.group("building_id")
        slot_id = manual_match.group("slot_id")
        slot = find_slot_by_building_and_slot(db, building_id, slot_id)
        if not slot:
            return None, "BUILDING_SLOT_NOT_FOUND"
        if not slot.is_active:
            return None, "INACTIVE"
        return slot, "BUILDING_SLOT"

    if message_text.startswith("Charge_Request_Slot_"):
        raw_value = message_text.replace("Charge_Request_Slot_", "", 1).strip()
        slot = find_slot_by_token(db, raw_value)
        if slot:
            if not slot.is_active:
                return None, "INACTIVE"
            return slot, "TOKEN"

        # Reject legacy slot-only messages such as Charge_Request_Slot_I41.
        return None, "LEGACY_SLOT_ONLY"

    return None, "NO_MATCH"


def slot_context(slot: ParkingSlot) -> dict[str, str]:
    return {
        "building_id": slot.building_id,
        "parking_slot_id": slot.parking_slot_id,
        "slot_id": slot.slot_id,
    }


def get_reply_button_id(message: dict) -> str:
    interactive = message.get("interactive") or {}
    button_reply = interactive.get("button_reply") or {}
    if button_reply.get("id"):
        return button_reply["id"]
    if button_reply.get("title"):
        return button_reply["title"]

    button = message.get("button") or {}
    return button.get("payload") or button.get("id") or button.get("text") or ""


def get_latest_job_by_step(db: Session, phone: str, steps: list[str]) -> Queue | None:
    return (
        db.query(Queue)
        .filter(Queue.phone_number == phone, Queue.current_step.in_(steps))
        .order_by(Queue.updated_at.desc())
        .first()
    )


def send_job_status(phone: str, job: Queue, db: Session):
    energy_kwh = get_energy_kwh(db, job.job_id)
    position, total = get_queue_position(db, job)
    location = format_job_location(db, job)

    queue_line = ""
    if job.current_step in ACTIVE_STEPS:
        queue_line = f"Queue Position: #{position} of {total}\n"

    send_whatsapp_text(
        phone,
        f"Live Charging Status {LIGHTNING}\n\n"
        f"Status: {job.current_step}\n"
        f"{queue_line}"
        f"{location}\n"
        f"Vehicle: {job.vehicle_number or 'Pending'}\n"
        f"Energy Used: {energy_kwh:.2f} kWh\n\n"
        "Type STATUS anytime for live status.\n"
        "Type STOP to request stop charging.",
    )


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
    command = normalize_command(text)

    button_id = get_reply_button_id(message)
    normalized_button_id = normalize_command(button_id)
    if button_id:
        print("WhatsApp button id:", button_id)

    if button_id:
        if button_id.startswith("fake_pay:") or normalized_button_id.startswith("pay"):
            if button_id.startswith("fake_pay:"):
                job_id = button_id.split("fake_pay:", 1)[1]
            else:
                job = get_latest_job_by_step(db, phone, ["INITIATED"])
                if not job:
                    send_whatsapp_text(phone, "Payment failed. Job not found.")
                    return {"ok": True}
                job_id = job.job_id

            job = db.get(Queue, job_id)

            if not job:
                send_whatsapp_text(phone, "Payment failed. Job not found.")
                return {"ok": True}

            if job.current_step != "INITIATED":
                send_whatsapp_text(
                    phone,
                    f"Payment is already processed or not required.\nCurrent status: {job.current_step}",
                )
                return {"ok": True}

            payment = PaymentDetails(
                transaction_id=f"WA-FAKE-{uuid4()}",
                job_id=job_id,
                payment_status="SUCCESS",
                amount_paid=100.00,
                target_kwh_limit=5.00,
            )
            db.add(payment)
            job.current_step = "ASSIGNED"
            db.commit()
            db.refresh(job)

            position, total = get_queue_position(db, job)
            location = format_job_location(db, job)

            send_whatsapp_text(
                phone,
                f"Payment successful {CHECK}\n\n"
                f"Job ID: {job.job_id}\n"
                f"Status: {job.current_step}\n"
                f"Queue Position: #{position} of {total}\n"
                f"{location}\n\n"
                "Type STATUS anytime to check live queue and charging status.\n"
                "Type STOP to request stop charging.\n\n"
                "A Juicer operator will serve requests first come, first serve.",
            )
            return {"ok": True}

        if button_id.startswith("check_status:") or normalized_button_id in ["check status", "status"]:
            if button_id.startswith("check_status:"):
                job_id = button_id.split("check_status:", 1)[1]
                job = db.get(Queue, job_id)
            else:
                job = get_latest_job_by_phone(db, phone)

            if not job:
                send_whatsapp_text(phone, "Status not found. Job does not exist.")
                return {"ok": True}

            send_job_status(phone, job, db)
            return {"ok": True}

    if not phone or not text:
        return {"ok": True}

    if command in ["hi", "hello", "start"]:
        send_whatsapp_text(
            phone,
            f"Welcome to Juicer EV Charging {LIGHTNING}\n\n"
            "Please scan the QR placed at your parking slot.\n\n"
            "Manual fallback format:\n"
            "Charge_Request_Building_BUILDING_ID_Slot_SLOT_ID\n\n"
            "Example:\n"
            "Charge_Request_Building_MANTRA_MOMENTS_Slot_I41",
        )
        return {"ok": True}

    if command in ["status", "live status", "check status", "vehicle status"]:
        job = get_latest_job_by_phone(db, phone)

        if not job:
            send_whatsapp_text(phone, "No active charging request found.")
            return {"ok": True}

        position, total = get_queue_position(db, job)
        energy_kwh = get_energy_kwh(db, job.job_id)
        location = format_job_location(db, job)

        if job.current_step == "INITIATED":
            message_text = (
                f"Your charging request is created {CHECK}\n\n"
                "Status: Payment Pending\n"
                f"Job ID: {job.job_id}\n"
                f"{location}\n"
                f"Vehicle: {job.vehicle_number or 'Pending'}\n\n"
                "Please complete payment to join the queue."
            )
        elif job.current_step in ACTIVE_STEPS:
            message_text = (
                f"Your Juicer request status {LIGHTNING}\n\n"
                f"Status: {job.current_step}\n"
                f"Job ID: {job.job_id}\n"
                f"Queue Position: #{position} of {total}\n"
                f"{location}\n"
                f"Vehicle: {job.vehicle_number or 'Pending'}\n"
                f"Energy Used: {energy_kwh:.2f} kWh\n\n"
                "Type STATUS anytime for live status.\n"
                "Type STOP to request stop charging."
            )
        else:
            message_text = (
                f"Your charging session is completed {CHECK}\n\n"
                f"Status: {job.current_step}\n"
                f"Job ID: {job.job_id}\n"
                f"{location}\n"
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
            charge_status = db.get(ChargeStatus, job.slot_id)
            if not charge_status:
                charge_status = db.query(ChargeStatus).filter(ChargeStatus.job_id == job.job_id).first()
            if charge_status:
                charge_status.is_charging_active = False
            charger_id = job.slot_id
            if charge_status:
                charger_id = charge_status.active_charger_id
            transaction_id = get_active_transaction(charger_id)
            print(
                f"Stop requested for job {job.job_id}, charger {charger_id}, transaction {transaction_id}"
            )
            db.commit()
            db.refresh(job)

            remote_stop_sent = False
            if transaction_id:
                remote_stop_sent = await send_remote_stop_transaction(
                    charger_id,
                    transaction_id,
                )

            stop_detail = (
                "Charging is being stopped now.\n"
                if remote_stop_sent
                else "Charging will be stopped by the Juicer operator.\n"
            )
            stop_message = (
                f"Charging stop request received {STOP_SIGN}\n\n"
                f"{stop_detail}"
                "Type STATUS anytime to check the latest session status."
            )

            send_whatsapp_text(
                phone,
                stop_message,
            )
        elif job.current_step == "STOP_REQUESTED":
            send_whatsapp_text(
                phone,
                f"Stop request is already active {STOP_SIGN}\n\nThe Juicer operator has been notified.",
            )
        else:
            send_whatsapp_text(
                phone,
                f"Stop is only available while charging.\nCurrent status: {job.current_step}",
            )
        return {"ok": True}

    resolved_slot, resolve_status = resolve_slot_from_message(db, text)

    if resolve_status == "INACTIVE":
        send_whatsapp_text(
            phone,
            f"This parking slot QR code has been deactivated {CROSS}\n\nPlease contact the admin.",
        )
        return {"ok": True}

    if resolve_status == "BUILDING_SLOT_NOT_FOUND":
        send_whatsapp_text(
            phone,
            f"Building/slot combination not found {CROSS}\n\n"
            "Please check the manual command format:\n"
            "Charge_Request_Building_BUILDING_ID_Slot_SLOT_ID\n\n"
            "Example:\n"
            "Charge_Request_Building_MANTRA_MOMENTS_Slot_I41",
        )
        return {"ok": True}

    if resolve_status == "LEGACY_SLOT_ONLY":
        send_whatsapp_text(
            phone,
            "This slot command is incomplete because the same slot number may exist in multiple buildings.\n\n"
            "Please scan the QR code placed at your parking slot or send:\n"
            "Charge_Request_Building_BUILDING_ID_Slot_SLOT_ID\n\n"
            "Example:\n"
            "Charge_Request_Building_MANTRA_MOMENTS_Slot_I41",
        )
        return {"ok": True}

    if resolved_slot:
        pending_slots[phone] = slot_context(resolved_slot)
        building_name = get_building_name(db, resolved_slot.building_id) or resolved_slot.building_id

        send_whatsapp_text(
            phone,
            f"Slot received {CHECK}\n\n"
            f"Building: {building_name}\n"
            f"Slot: {resolved_slot.slot_id}\n\n"
            "Please send your vehicle number.\n"
            "Example: MH12AB1234",
        )
        return {"ok": True}

    if phone in pending_slots:
        context = pending_slots.pop(phone)
        vehicle_number = normalize_vehicle_number(text)

        if not is_valid_vehicle_number(vehicle_number):
            pending_slots[phone] = context
            send_whatsapp_text(
                phone,
                f"Invalid vehicle number format {CROSS}\n\n"
                "Please send a valid Indian vehicle number.\n"
                "Example: MH12AB1234",
            )
            return {"ok": True}

        job = create_or_update_request(
            db,
            phone,
            context["slot_id"],
            vehicle_number,
            building_id=context.get("building_id"),
            parking_slot_id=context.get("parking_slot_id"),
        )

        send_payment_button(phone, job.job_id)
        return {"ok": True}

    send_whatsapp_text(
        phone,
        "Sorry, I did not understand.\n\n"
        "Send 'hi', 'status', 'stop', scan a Juicer QR, or send:\n"
        "Charge_Request_Building_BUILDING_ID_Slot_SLOT_ID",
    )
    return {"ok": True}
