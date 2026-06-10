# Juicer Backend

Run locally:

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Docs:

```text
http://localhost:8000/docs
```

WhatsApp callback URL:

```text
https://your-backend.onrender.com/webhooks/whatsapp
```
