from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ChargeStatus
from app.schemas import TelemetryRequest
from app.services.charger_service import register_charger, unregister_charger, send_cutoff_command

router = APIRouter(prefix="/charger", tags=["Charger"])

@router.post("/telemetry")
async def telemetry(payload: TelemetryRequest, db: Session = Depends(get_db)):
    status = db.get(ChargeStatus, payload.charger_id)
    if not status:
        status = ChargeStatus(active_charger_id=payload.charger_id, job_id=payload.job_id, current_wh_delivered=payload.current_wh_delivered, is_charging_active=True)
        db.add(status)
    else:
        status.job_id = payload.job_id
        status.current_wh_delivered = payload.current_wh_delivered
        status.is_charging_active = True
    db.commit()

    cutoff_required = payload.current_wh_delivered >= payload.target_wh_limit
    if cutoff_required:
        await send_cutoff_command(payload.charger_id)
        status.is_charging_active = False
        db.commit()

    return {"ok": True, "cutoff_required": cutoff_required}

@router.websocket("/ws/{charger_id}")
async def charger_socket(websocket: WebSocket, charger_id: str):
    await websocket.accept()
    await register_charger(charger_id, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            print(f"Charger {charger_id}:", msg)
            await websocket.send_text("ACK")
    except WebSocketDisconnect:
        unregister_charger(charger_id)
