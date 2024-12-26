from database import engine
import models
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_tables():
    logger.info("Starting table creation...")
    models.Base.metadata.drop_all(bind=engine)
    logger.info("Dropped existing tables")
    models.Base.metadata.create_all(bind=engine)
    logger.info("Created new tables")

if __name__ == "__main__":
    create_tables() 