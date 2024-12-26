from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Dict, Optional
import json
import os
import logging
import jwt
from jwt.exceptions import PyJWTError
import asyncio

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

import models
import auth
from database import engine, get_db
from pydantic import BaseModel

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Get environment
is_development = os.getenv('ENV', 'production') == 'development'
# Allow all origins for now to test cross-computer functionality
allowed_origins = ["*"]

logger.info(f"Environment: {'development' if is_development else 'production'}")
logger.info(f"Allowed origins: {allowed_origins}")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models
class UserCreate(BaseModel):
    email: str
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# Add this function to verify the token
async def get_current_user_from_token(
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
) -> Optional[models.User]:
    if not token:
        return None
        
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
    except PyJWTError:
        return None
        
    user = db.query(models.User).filter(models.User.username == username).first()
    return user

# Modify the WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[Dict[str, any]] = []
        self.user_cursors: Dict[str, dict] = {}
        self.shapes: List[dict] = []
        self.status_task = None
        self.whiteboard_id = os.urandom(8).hex()  # Generate a unique ID for this whiteboard instance
        logger.info(f"ConnectionManager initialized with whiteboard ID: {self.whiteboard_id}")

    def start_periodic_broadcast(self):
        """Start the periodic status broadcast"""
        if not self.status_task:
            try:
                loop = asyncio.get_event_loop()
                self.status_task = loop.create_task(self._periodic_status_broadcast())
            except RuntimeError:
                logger.error("Could not start periodic broadcast - no event loop running")

    async def _periodic_status_broadcast(self):
        """Broadcast connection status every 5 seconds"""
        while True:
            try:
                active_users = [
                    {
                        'username': conn['user'].username if conn['user'] else 'Anonymous',
                        'ip': conn['socket'].client.host
                    }
                    for conn in self.active_connections
                ]
                
                status_message = {
                    'type': 'status_update',
                    'payload': {
                        'whiteboard_id': self.whiteboard_id,
                        'total_connections': len(self.active_connections),
                        'active_users': active_users,
                        'total_cursors': len(self.user_cursors),
                        'cursor_usernames': list(self.user_cursors.keys())
                    }
                }
                
                logger.info(f"=== WebSocket Status Update ===")
                logger.info(f"Whiteboard ID: {self.whiteboard_id}")
                logger.info(f"Total Connections: {len(self.active_connections)}")
                logger.info(f"Active Users: {[user['username'] for user in active_users]}")
                logger.info(f"Total Cursors: {len(self.user_cursors)}")
                logger.info(f"Cursor Usernames: {list(self.user_cursors.keys())}")
                logger.info("============================")
                
                # Broadcast status to all clients
                await self._broadcast_message(json.dumps(status_message))
            except Exception as e:
                logger.error(f"Error in periodic status broadcast: {str(e)}")
            
            await asyncio.sleep(2)  # Wait for 5 seconds

    async def connect(self, websocket: WebSocket, user: Optional[models.User] = None):
        await websocket.accept()
        
        # If user already has a connection, clean it up first
        if user:
            await self._cleanup_existing_connection(user.username)
        
        connection_info = {
            "socket": websocket,
            "user": user
        }
        self.active_connections.append(connection_info)
        logger.info(f"New client connected to whiteboard {self.whiteboard_id}. User: {user.username if user else 'Anonymous'}")
        logger.info(f"Total connections: {len(self.active_connections)}")
        logger.info(f"Active users: {[conn['user'].username if conn['user'] else 'Anonymous' for conn in self.active_connections]}")
        
        # Send current state to the new client
        state_message = json.dumps({
            'type': 'current_state',
            'payload': {
                'whiteboard_id': self.whiteboard_id,
                'shapes': self.shapes,
                'cursors': [
                    {k: v for k, v in cursor.items() if k not in ['websocket', 'user']}
                    for cursor in self.user_cursors.values()
                ]
            }
        })
        logger.info(f"Sending initial state to new client on whiteboard {self.whiteboard_id}. Current cursors: {[cursor.get('username') for cursor in self.user_cursors.values()]}")
        await websocket.send_text(state_message)

    async def _cleanup_existing_connection(self, username: str):
        """Clean up any existing connection for a user before creating a new one"""
        existing_connections = [
            conn for conn in self.active_connections 
            if conn["user"] and conn["user"].username == username
        ]
        
        for conn in existing_connections:
            logger.info(f"Cleaning up existing connection for user: {username}")
            try:
                await conn["socket"].close()
                self.active_connections.remove(conn)
            except Exception as e:
                logger.error(f"Error closing existing connection for user {username}: {str(e)}")

    async def cleanup_user(self, username: str):
        """Clean up all resources associated with a user"""
        logger.info(f"Cleaning up resources for user: {username}")
        
        # Remove user's cursor
        if username in self.user_cursors:
            logger.info(f"Removing cursor for user: {username}")
            del self.user_cursors[username]
            await self._broadcast_cursor_removal(username)
        
        # Remove user's connections
        await self._cleanup_existing_connection(username)
        
        logger.info(f"Cleanup complete for user: {username}")
        logger.info(f"Remaining connections: {len(self.active_connections)}")
        logger.info(f"Remaining users: {[conn['user'].username if conn['user'] else 'Anonymous' for conn in self.active_connections]}")

    def disconnect(self, websocket: WebSocket):
        # Find and remove the connection
        connection_to_remove = None
        for conn in self.active_connections:
            if conn["socket"] == websocket:
                connection_to_remove = conn
                break
                
        if connection_to_remove:
            self.active_connections.remove(connection_to_remove)
            user = connection_to_remove["user"]
            if user:
                username = user.username
                if username in self.user_cursors:
                    logger.info(f"Removing cursor for disconnected user: {username}")
                    del self.user_cursors[username]
                    # Broadcast cursor removal synchronously to ensure it happens
                    asyncio.create_task(self._broadcast_cursor_removal(username))
            
            logger.info(f"Client disconnected. Remaining connections: {len(self.active_connections)}")
            logger.info(f"Remaining users: {[conn['user'].username if conn['user'] else 'Anonymous' for conn in self.active_connections]}")

    async def broadcast(self, message: str, exclude_websocket: WebSocket = None, current_user: Optional[models.User] = None):
        try:
            data = json.loads(message)
            message_type = data.get('type')
            payload = data.get('payload', {})
            logger.info(f"Broadcasting message type: {message_type} from user: {current_user.username if current_user else 'Anonymous'}")

            if message_type == 'cursor_move':
                if not current_user:  # Only handle cursor moves from authenticated users
                    logger.warning("Received cursor_move from unauthenticated user")
                    return
                    
                username = current_user.username
                if payload.get('remove'):
                    # Handle explicit logout/cleanup request
                    await self.cleanup_user(username)
                    return
                else:
                    # Update cursor data with user information
                    cursor_data = {
                        **payload,
                        'id': username,  # Use username as ID
                        'username': username,  # Use actual username
                        'websocket': exclude_websocket,
                        'user': current_user
                    }
                    self.user_cursors[username] = cursor_data
                    logger.info(f"Updated cursor for user {username}. Total cursors: {len(self.user_cursors)}")
                    logger.info(f"Current cursor positions: {[(k, v.get('x', 'N/A'), v.get('y', 'N/A')) for k, v in self.user_cursors.items()]}")
                    
                    # Broadcast cursor without sensitive information
                    broadcast_data = {
                        'id': username,
                        'x': cursor_data['x'],
                        'y': cursor_data['y'],
                        'color': cursor_data['color'],
                        'username': username
                    }
                    cursor_message = json.dumps({
                        'type': 'cursor_move',
                        'payload': broadcast_data
                    })
                    logger.info(f"Broadcasting cursor update: {broadcast_data}")
                    await self._broadcast_message(cursor_message, exclude_websocket)
                return

            elif message_type == 'shape_add':
                self.shapes.append(payload)
                await self._broadcast_message(message)

            elif message_type == 'shape_update':
                for i, shape in enumerate(self.shapes):
                    if shape.get('id') == payload.get('id'):
                        self.shapes[i] = payload
                        await self._broadcast_message(message)
                        break

            elif message_type == 'shape_delete':
                shape_ids = payload.get('ids', [])
                self.shapes = [s for s in self.shapes if s.get('id') not in shape_ids]
                await self._broadcast_message(message)

            elif message_type == 'clear':
                self.shapes = []
                await self._broadcast_message(message)

            elif message_type == 'request_state':
                logger.info("Received state request")
                # Send current state to the requesting client
                state_message = json.dumps({
                    'type': 'current_state',
                    'payload': {
                        'shapes': self.shapes,
                        'cursors': [
                            {k: v for k, v in cursor.items() if k not in ['websocket', 'user']}
                            for cursor in self.user_cursors.values()
                        ]
                    }
                })
                logger.info(f"Sending current state. Cursors: {self.user_cursors}")
                if exclude_websocket:
                    await exclude_websocket.send_text(state_message)
                return
            
        except Exception as e:
            logger.error(f"Error broadcasting message: {str(e)}", exc_info=True)

    async def _broadcast_message(self, message: str, exclude_websocket: WebSocket = None):
        logger.info(f"Broadcasting to {len(self.active_connections)} clients")
        
        message_data = json.loads(message)
        logger.info(f"Message type: {message_data.get('type')}")
        if message_data.get('type') == 'cursor_move':
            logger.info(f"Cursor update for user: {message_data.get('payload', {}).get('username')}")
        
        disconnected = []
        sent_count = 0
        for conn in self.active_connections:
            websocket = conn["socket"]
            if websocket != exclude_websocket:
                try:
                    await websocket.send_text(message)
                    sent_count += 1
                    logger.info(f"Successfully sent message to user: {conn['user'].username if conn['user'] else 'Anonymous'}")
                except Exception as e:
                    logger.error(f"Error sending message to client: {str(e)}")
                    disconnected.append(websocket)

        logger.info(f"Successfully sent message to {sent_count} clients")
        
        # Clean up disconnected clients
        for websocket in disconnected:
            await self.disconnect(websocket)

    async def _broadcast_cursor_removal(self, username: str):
        logger.info(f"Broadcasting cursor removal for user: {username}")
        removal_message = json.dumps({
            'type': 'cursor_move',
            'payload': {'id': username, 'remove': True}
        })
        await self._broadcast_message(removal_message)

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    """Initialize the periodic status broadcast when the application starts"""
    manager.start_periodic_broadcast()
    logger.info("Started periodic status broadcast")

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
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    client_host = websocket.client.host
    logger.info(f"New WebSocket connection attempt from IP: {client_host}")
    
    user = await get_current_user_from_token(token, db)
    logger.info(f"User authenticated: {user.username if user else 'Anonymous'} from IP: {client_host}")
    
    await manager.connect(websocket, user)
    try:
        while True:
            data = await websocket.receive_text()
            logger.info(f"Received message from user {user.username if user else 'Anonymous'} at {client_host}: {data[:200]}...")
            await manager.broadcast(data, exclude_websocket=websocket, current_user=user)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user.username if user else 'Anonymous'} at {client_host}")
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error for user {user.username if user else 'Anonymous'} at {client_host}: {str(e)}", exc_info=True)
        manager.disconnect(websocket)

@app.get("/")
async def health_check():
    return {"status": "healthy", "message": "API is running"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port) 