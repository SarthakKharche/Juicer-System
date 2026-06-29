from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import Base, engine
from app.routes import whatsapp, customer, juicer, payment, charger, admin, ocpp

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Juicer Backend API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(whatsapp.router)
app.include_router(customer.router)
app.include_router(juicer.router)
app.include_router(payment.router)
app.include_router(charger.router)
app.include_router(ocpp.router)
app.include_router(admin.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "juicer-backend"}

@app.get("/")
def root():
    return {"message": "Juicer Backend API running"}
