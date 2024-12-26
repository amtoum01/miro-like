import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Get DATABASE_URL from Railway's environment variable
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:UXwLKiZQVBracxEMfjExpjpRVPqRszNi@junction.proxy.rlwy.net:51820/railway")

logger.info(f"Using database URL: {DATABASE_URL}")

# If using PostgreSQL from Railway, convert the URL to work with SQLAlchemy
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    logger.info(f"Converted database URL to: {DATABASE_URL}")

# Create engine with proper URL and timeout settings
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={
        'connect_timeout': 10,
        'keepalives': 1,
        'keepalives_idle': 30,
        'keepalives_interval': 10,
        'keepalives_count': 5
    }
)
logger.info("Database engine created successfully")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()