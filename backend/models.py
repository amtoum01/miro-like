from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Boolean, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_active = Column(Boolean, default=True)

    boards = relationship("Board", back_populates="owner")

class Board(Base):
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    owner_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="boards")
    shapes = relationship("Shape", back_populates="board", cascade="all, delete-orphan")

class Shape(Base):
    __tablename__ = "shapes"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(Integer, ForeignKey("boards.id"))
    type = Column(String)  # rectangle, circle, etc.
    properties = Column(JSON)  # x, y, width, height, etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    board = relationship("Board", back_populates="shapes")

class Whiteboard(Base):
    __tablename__ = "whiteboards"

    id = Column(Integer, primary_key=True, index=True)
    board_id = Column(String, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Integer, default=1)  # Use this as a boolean flag