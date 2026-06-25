import json
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.models import ChargeStatus, PaymentDetails, Queue
from app.services.whatsapp_service import send_whatsapp_text
from app.services.charger_service import (
    register_charger,
    unregister_charger,
)

router = APIRouter(prefix="/ocpp", tags=["OCPP"])

CALL = 2
CALL_RESULT = 3
CALL_ERROR = 4

charger_transactions: dict[str, str] = {}


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def call_result(unique_id: str, payload: dict):
    return [CALL_RESULT, unique_id, payload]


def call_error(unique_id: str, code: str, description: str):
    return [CALL_ERROR, unique_id, code, description, {}]


def remote_stop_call(transaction_id: str):
    return [
        CALL,
        str(uuid4()),
        "RemoteStopTransaction",
        {"transactionId": int(transaction_id)},
    ]


def find_charging_job(db, charger_id: str) -> Queue | None:
    charge_status = db.get(ChargeStatus, charger_id)
    if charge_status and charge_status.job_id:
        job = db.get(Queue, charge_status.job_id)
        if job:
            return job

    job = (
        db.query(Queue)
        .filter(
            Queue.slot_id == charger_id,
            Queue.current_step.in_(["ASSIGNED", "ENROUTE", "CHARGING", "STOP_REQUESTED"]),
        )
        .order_by(Queue.updated_at.desc())
        .first()
    )
    if job:
        return job

    job = (
        db.query(Queue)
        .filter(Queue.current_step == "CHARGING")
        .order_by(Queue.updated_at.desc())
        .first()
    )
    return job


def get_target_wh(db, job_id: str | None) -> float | None:
    if not job_id:
        return None

    payment = (
        db.query(PaymentDetails)
        .filter(PaymentDetails.job_id == job_id)
        .order_by(PaymentDetails.transaction_id.desc())
        .first()
    )

    if not payment:
        return None

    return float(payment.target_kwh_limit or 0) * 1000


def extract_meter_wh(payload: dict) -> float | None:
    readings = payload.get("meterValue") or []

    for meter_value in readings:
        sampled_values = meter_value.get("sampledValue") or []
        for sampled in sampled_values:
            measurand = sampled.get("measurand", "Energy.Active.Import.Register")
            if "Energy" not in measurand:
                continue

            try:
                value = float(sampled.get("value"))
            except (TypeError, ValueError):
                continue

            unit = (sampled.get("unit") or "Wh").lower()
            if unit == "kwh":
                return value * 1000
            return value

    return None


def send_completion_message(job: Queue, energy_kwh: float):
    send_whatsapp_text(
        job.phone_number,
        "Charging completed ✅\n\n"
        f"Vehicle: {job.vehicle_number}\n"
        f"Slot: {job.slot_id}\n"
        f"Energy Delivered: {energy_kwh:.2f} kWh\n\n"
        "Thank you for using Juicer ⚡",
    )


async def handle_ocpp_call(charger_id: str, action: str, payload: dict) -> dict:
    with SessionLocal() as db:
        if action == "BootNotification":
            return {
                "currentTime": utc_now_iso(),
                "interval": 30,
                "status": "Accepted",
            }

        if action == "Heartbeat":
            return {"currentTime": utc_now_iso()}

        if action == "Authorize":
            return {"idTagInfo": {"status": "Accepted"}}

        if action == "StatusNotification":
            return {}

        if action == "StartTransaction":
            job = find_charging_job(db, charger_id)
            transaction_id = abs(hash(f"{charger_id}:{uuid4()}")) % 2147483647
            charger_transactions[charger_id] = str(transaction_id)

            if job and job.current_step in ["ASSIGNED", "ENROUTE"]:
                job.current_step = "CHARGING"

            status = db.get(ChargeStatus, charger_id)
            if not status:
                status = ChargeStatus(
                    active_charger_id=charger_id,
                    job_id=job.job_id if job else None,
                    current_wh_delivered=float(payload.get("meterStart") or 0),
                    is_charging_active=True,
                )
                db.add(status)
            else:
                status.job_id = job.job_id if job else status.job_id
                status.current_wh_delivered = float(payload.get("meterStart") or 0)
                status.is_charging_active = True

            db.commit()

            return {
                "transactionId": transaction_id,
                "idTagInfo": {"status": "Accepted"},
            }

        if action == "MeterValues":
            meter_wh = extract_meter_wh(payload)
            transaction_id = str(
                payload.get("transactionId") or charger_transactions.get(charger_id) or ""
            )

            status = db.get(ChargeStatus, charger_id)
            if not status:
                job = find_charging_job(db, charger_id)
                status = ChargeStatus(
                    active_charger_id=charger_id,
                    job_id=job.job_id if job else None,
                    current_wh_delivered=0,
                    is_charging_active=True,
                )
                db.add(status)
            elif not status.job_id:
                job = find_charging_job(db, charger_id)
                if job:
                    status.job_id = job.job_id
                    if job.current_step in ["ASSIGNED", "ENROUTE"]:
                        job.current_step = "CHARGING"

            if meter_wh is not None:
                status.current_wh_delivered = meter_wh
            status.is_charging_active = True

            target_wh = get_target_wh(db, status.job_id)
            cutoff_required = target_wh is not None and float(status.current_wh_delivered or 0) >= target_wh

            completed_job = None
            if cutoff_required:
                status.is_charging_active = False
                if status.job_id:
                    job = db.get(Queue, status.job_id)
                    if job and job.current_step in ["CHARGING", "STOP_REQUESTED"]:
                        job.current_step = "COMPLETED"
                        completed_job = job

            db.commit()

            if completed_job:
                send_completion_message(
                    completed_job,
                    float(status.current_wh_delivered or 0) / 1000,
                )

            return {
                "transactionId": transaction_id,
                "cutoffRequired": cutoff_required,
                "currentWhDelivered": float(status.current_wh_delivered or 0),
                "targetWhLimit": target_wh,
            }

        if action == "StopTransaction":
            status = db.get(ChargeStatus, charger_id)
            if status:
                status.is_charging_active = False
                meter_stop = payload.get("meterStop")
                if meter_stop is not None:
                    status.current_wh_delivered = float(meter_stop)
                db.commit()

            charger_transactions.pop(charger_id, None)
            return {"idTagInfo": {"status": "Accepted"}}

        return {}


@router.websocket("/{charger_id}")
async def ocpp_socket(websocket: WebSocket, charger_id: str):
    requested_protocols = websocket.headers.get("sec-websocket-protocol", "")
    subprotocol = "ocpp1.6" if "ocpp1.6" in requested_protocols else None
    await websocket.accept(subprotocol=subprotocol)
    await register_charger(charger_id, websocket)

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            if not isinstance(message, list) or len(message) < 3:
                continue

            message_type = message[0]
            unique_id = message[1]

            if message_type != CALL:
                continue

            action = message[2]
            payload = message[3] if len(message) > 3 and isinstance(message[3], dict) else {}

            try:
                response_payload = await handle_ocpp_call(charger_id, action, payload)
                await websocket.send_text(json.dumps(call_result(unique_id, response_payload)))
                transaction_id = response_payload.get("transactionId")
                if response_payload.get("cutoffRequired") and transaction_id:
                    await websocket.send_text(json.dumps(remote_stop_call(transaction_id)))
            except Exception as exc:
                await websocket.send_text(
                    json.dumps(call_error(unique_id, "InternalError", str(exc)))
                )
    except WebSocketDisconnect:
        unregister_charger(charger_id)
