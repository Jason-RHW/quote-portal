import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./quote_portal.db")

is_sqlite = DATABASE_URL.startswith("sqlite")

# SQLite: needs check_same_thread=False, uses default pool
# PostgreSQL (local or Supabase): NullPool — each request gets a fresh
# connection and closes it immediately. Correct for serverless (Vercel)
# and works fine for local dev too. Supabase's PgBouncer handles pooling
# at the database level so we don't need SQLAlchemy to pool on top.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    poolclass=None if is_sqlite else NullPool,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
