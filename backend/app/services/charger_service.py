active_charger_sockets = {}

async def send_cutoff_command(charger_id: str):
    websocket = active_charger_sockets.get(charger_id)
    if websocket:
        await websocket.send_text("CUTOFF")
        return True
    print(f"No active socket for charger {charger_id}. Firmware fallback should cut off if disconnected.")
    return False

async def register_charger(charger_id: str, websocket):
    active_charger_sockets[charger_id] = websocket

def unregister_charger(charger_id: str):
    active_charger_sockets.pop(charger_id, None)
