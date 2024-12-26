import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv(override=True)

# Get DATABASE_URL from environment variable
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    logger.warning("DATABASE_URL not found in environment, using SQLite as fallback")
    DATABASE_URL = "sqlite:///./whiteboard.db"

logger.info(f"Using database URL: {DATABASE_URL}")

# If using PostgreSQL from Railway, convert the URL to work with SQLAlchemy
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    logger.info(f"Converted database URL to: {DATABASE_URL}")

# Create engine with proper URL
engine = create_engine(DATABASE_URL)
logger.info("Database engine created successfully")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()