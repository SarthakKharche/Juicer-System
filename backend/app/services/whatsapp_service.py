import requests
from app.config import settings

CHECK = "\u2705"
LIGHTNING = "\u26a1"
RUPEE = "\u20b9"


def send_whatsapp_text(to: str, text: str) -> dict:
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": text},
    }

    return send_whatsapp_payload(payload)


def send_payment_button(to: str, job_id: str) -> dict:
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {
                "text": (
                    f"Charging request created {CHECK}\n\n"
                    f"Job ID: {job_id}\n\n"
                    f"Amount: {RUPEE}100\n"
                    "Tap below to simulate payment."
                )
            },
            "action": {
                "buttons": [
                    {
                        "type": "reply",
                        "reply": {
                            "id": f"fake_pay:{job_id}",
                            "title": f"Pay {RUPEE}100",
                        },
                    }
                ]
            },
        },
    }

    return send_whatsapp_payload(payload)


def send_status_button(to: str, job_id: str) -> dict:
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {
                "text": (
                    f"Charging started {LIGHTNING}\n\n"
                    f"Job ID: {job_id}\n\n"
                    "You can:\n"
                    "\u2022 Tap Check Status\n"
                    "\u2022 Type STATUS anytime\n"
                    "\u2022 Type STOP to request stop charging"
                )
            },
            "action": {
                "buttons": [
                    {
                        "type": "reply",
                        "reply": {
                            "id": f"check_status:{job_id}",
                            "title": "Check Status",
                        },
                    }
                ]
            },
        },
    }

    return send_whatsapp_payload(payload)


def send_whatsapp_payload(payload: dict) -> dict:
    if not settings.META_ACCESS_TOKEN or not settings.META_PHONE_NUMBER_ID:
        try:
            print("WhatsApp env vars missing. Payload not sent:", payload)
        except UnicodeEncodeError:
            print("WhatsApp env vars missing. Payload not sent (Unicode-safe):", str(payload).encode('ascii', 'replace').decode('ascii'))
        return {"skipped": True}

    url = f"https://graph.facebook.com/v25.0/{settings.META_PHONE_NUMBER_ID}/messages"

    headers = {
        "Authorization": f"Bearer {settings.META_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }

    try:
        print("Sending WhatsApp payload:", payload)
    except UnicodeEncodeError:
        print("Sending WhatsApp payload (Unicode-safe):", str(payload).encode('ascii', 'replace').decode('ascii'))

    response = requests.post(
        url,
        json=payload,
        headers=headers,
        timeout=15,
    )

    print("WhatsApp API status:", response.status_code)
    print("WhatsApp API response:", response.text)

    try:
        return response.json()
    except Exception:
        return {
            "status_code": response.status_code,
            "text": response.text,
        }
