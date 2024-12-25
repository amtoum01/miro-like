from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Dict
import json
import os
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import models
import auth
from database import engine, get_db
from pydantic import BaseModel

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://miro-like-chi.vercel.app", "http://localhost:3000"],
    allow_credentials=True,  # Changed to True to support WebSocket
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add WebSocket-specific CORS headers
@app.middleware("http")
async def add_websocket_cors_headers(request, call_next):
    response = await call_next(request)
    if request.url.path == "/ws":
        response.headers["Access-Control-Allow-Origin"] = "https://miro-like-chi.vercel.app"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

# Pydantic models
class UserCreate(BaseModel):
    email: str
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_cursors: Dict[str, dict] = {}
        self.boards: Dict[str, List[dict]] = {
            'default': []  # Default board that everyone will use
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            # Find and remove the cursor for the disconnected user
            disconnected_user = None
            for user_id, cursor in self.user_cursors.items():
                if cursor.get('websocket') == websocket:
                    disconnected_user = user_id
                    break
            if disconnected_user:
                del self.user_cursors[disconnected_user]
            logger.info(f"Client disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: str, exclude_websocket: WebSocket = None):
        try:
            data = json.loads(message)
            message_type = data.get('type')
            payload = data.get('payload', {})
            board_id = payload.get('boardId', 'default')  # Use default board if not specified

            if message_type == 'cursor_move':
                user_id = payload.get('id')
                if payload.get('remove'):
                    # Remove cursor when user leaves
                    if user_id in self.user_cursors:
                        del self.user_cursors[user_id]
                    # Broadcast cursor removal to all clients
                    removal_message = json.dumps({
                        'type': 'cursor_move',
                        'payload': {'id': user_id, 'remove': True}
                    })
                    await self._broadcast_message(removal_message, exclude_websocket)
                else:
                    # Update cursor position and associate with WebSocket
                    cursor_data = {**payload, 'websocket': exclude_websocket}
                    self.user_cursors[user_id] = cursor_data
                    # Broadcast cursor update without the websocket field
                    broadcast_data = {k: v for k, v in cursor_data.items() if k != 'websocket'}
                    cursor_message = json.dumps({
                        'type': 'cursor_move',
                        'payload': broadcast_data
                    })
                    await self._broadcast_message(cursor_message, exclude_websocket)
                return
            elif message_type == 'request_state':
                # Send current state to the requesting client
                state_message = json.dumps({
                    'type': 'current_state',
                    'payload': {
                        'shapes': self.boards.get(board_id, []),
                        'cursors': [
                            {k: v for k, v in cursor.items() if k != 'websocket'}
                            for cursor in self.user_cursors.values()
                        ],
                        'boardId': board_id
                    }
                })
                if exclude_websocket:
                    await exclude_websocket.send_text(state_message)
                return
            elif message_type == 'shape_add':
                if board_id not in self.boards:
                    self.boards[board_id] = []
                self.boards[board_id].append(payload)
            elif message_type == 'shape_update':
                if board_id in self.boards:
                    for i, shape in enumerate(self.boards[board_id]):
                        if shape.get('id') == payload.get('id'):
                            self.boards[board_id][i] = payload
                            break
            elif message_type == 'shape_delete':
                if board_id in self.boards:
                    shape_ids = payload.get('ids', [])
                    self.boards[board_id] = [
                        s for s in self.boards[board_id] 
                        if s.get('id') not in shape_ids
                    ]
            elif message_type == 'clear':
                if board_id in self.boards:
                    self.boards[board_id] = []
            
            # Broadcast the original message to all clients
            await self._broadcast_message(message, exclude_websocket)
            
        except Exception as e:
            logger.error(f"Error broadcasting message: {str(e)}")

    async def _broadcast_message(self, message: str, exclude_websocket: WebSocket = None):
        disconnected = []
        for connection in self.active_connections:
            if connection != exclude_websocket:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"Error sending message to client: {str(e)}")
                    disconnected.append(connection)

        # Clean up disconnected clients
        for connection in disconnected:
            await self.disconnect(connection)

manager = ConnectionManager()

# Routes
@app.post("/register", response_model=Token)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    db_user = db.query(models.User).filter(models.User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        username=user.username,
        hashed_password=hashed_password
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received message: {data[:200]}...")  # Log first 200 chars
            await manager.broadcast(data, exclude_websocket=websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        manager.disconnect(websocket)

@app.get("/")
async def health_check():
    return {"status": "healthy", "message": "API is running"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port) 