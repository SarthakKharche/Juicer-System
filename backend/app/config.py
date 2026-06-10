from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

class Settings(BaseModel):
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/juicer_db")
    VERIFY_TOKEN: str = os.getenv("VERIFY_TOKEN", "juicer_bot_2025")
    META_ACCESS_TOKEN: str = os.getenv("META_ACCESS_TOKEN", "")
    META_PHONE_NUMBER_ID: str = os.getenv("META_PHONE_NUMBER_ID", "")
    META_APP_SECRET: str = os.getenv("META_APP_SECRET", "")

settings = Settings()
