import requests
from app.config import settings

def send_whatsapp_text(to: str, text: str) -> dict:
    if not settings.META_ACCESS_TOKEN or not settings.META_PHONE_NUMBER_ID:
        print("WhatsApp env vars missing. Message not sent:", to, text)
        return {"skipped": True}

    url = f"https://graph.facebook.com/v25.0/{settings.META_PHONE_NUMBER_ID}/messages"
    payload = {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": text}}
    headers = {"Authorization": f"Bearer {settings.META_ACCESS_TOKEN}", "Content-Type": "application/json"}
    response = requests.post(url, json=payload, headers=headers, timeout=15)
    try:
        return response.json()
    except Exception:
        return {"status_code": response.status_code, "text": response.text}
