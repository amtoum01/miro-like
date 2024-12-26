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
from sqlalchemy import func, and_

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
        self.shapes: List[dict] = []  # Cache of shapes
        self.status_task = None
        self.whiteboard_id = None
        self._whiteboard_lock = asyncio.Lock()
        self._db: Optional[Session] = None  # Store db session
        logger.info("ConnectionManager initialized")

    async def get_or_create_whiteboard(self, db: Session) -> str:
        """Get the active whiteboard ID or create a new one if none exists"""
        async with self._whiteboard_lock:
            if self.whiteboard_id:
                return self.whiteboard_id

            try:
                self._db = db  # Store db session for later use
                active_whiteboard = db.query(models.Whiteboard).filter(
                    models.Whiteboard.is_active == 1
                ).with_for_update().first()

                if active_whiteboard:
                    self.whiteboard_id = active_whiteboard.board_id
                    # Load shapes from database
                    db_shapes = db.query(models.WhiteboardShape).filter(
                        models.WhiteboardShape.whiteboard_id == self.whiteboard_id
                    ).all()
                    self.shapes = [shape.shape_data for shape in db_shapes]
                    logger.info(f"Loaded {len(self.shapes)} shapes for whiteboard: {self.whiteboard_id}")
                else:
                    new_board_id = os.urandom(8).hex()
                    new_whiteboard = models.Whiteboard(board_id=new_board_id)
                    db.add(new_whiteboard)
                    db.commit()
                    db.refresh(new_whiteboard)
                    self.whiteboard_id = new_board_id
                    logger.info(f"Created new whiteboard: {self.whiteboard_id}")

                return self.whiteboard_id
            except Exception as e:
                logger.error(f"Error in get_or_create_whiteboard: {str(e)}")
                db.rollback()
                raise

    async def save_shape(self, shape: dict):
        """Save a completed shape to the database"""
        if not self._db or not self.whiteboard_id:
            logger.error("Cannot save shape: no database session or whiteboard ID")
            return

        try:
            new_shape = models.WhiteboardShape(
                whiteboard_id=self.whiteboard_id,
                shape_data=shape
            )
            self._db.add(new_shape)
            self._db.commit()
            logger.info(f"Saved completed shape to database")
        except Exception as e:
            logger.error(f"Error saving shape to database: {str(e)}")
            self._db.rollback()

    async def get_latest_shapes(self):
        """Get the latest version of each shape from the database"""
        if not self._db or not self.whiteboard_id:
            logger.error("Cannot get shapes: no database session or whiteboard ID")
            return []

        try:
            # Subquery to get the latest version of each shape
            latest_versions = self._db.query(
                models.WhiteboardShape.shape_data['id'].astext.label('shape_id'),
                func.max(models.WhiteboardShape.version).label('max_version')
            ).filter(
                models.WhiteboardShape.whiteboard_id == self.whiteboard_id
            ).group_by(
                models.WhiteboardShape.shape_data['id'].astext
            ).subquery()

            # Get the actual shape data for the latest versions
            latest_shapes = self._db.query(models.WhiteboardShape).join(
                latest_versions,
                and_(
                    models.WhiteboardShape.shape_data['id'].astext == latest_versions.c.shape_id,
                    models.WhiteboardShape.version == latest_versions.c.max_version
                )
            ).all()

            return [shape.shape_data for shape in latest_shapes]

        except Exception as e:
            logger.error(f"Error getting latest shapes: {str(e)}")
            return []

    async def delete_shape(self, shape_id: str):
        """Delete a shape from the database"""
        if not self._db or not self.whiteboard_id:
            logger.error("Cannot delete shape: no database session or whiteboard ID")
            return

        try:
            # Delete the shape from database
            result = self._db.query(models.WhiteboardShape).filter(
                models.WhiteboardShape.whiteboard_id == self.whiteboard_id,
                models.WhiteboardShape.shape_data['id'].astext == str(shape_id)
            ).delete(synchronize_session=False)
            self._db.commit()
            logger.info(f"Deleted shape {shape_id} from database. Rows affected: {result}")
        except Exception as e:
            logger.error(f"Error deleting shape from database: {str(e)}")
            self._db.rollback()

    async def clear_all_shapes(self):
        """Clear all shapes for the current whiteboard"""
        if not self._db or not self.whiteboard_id:
            logger.error("Cannot clear shapes: no database session or whiteboard ID")
            return

        try:
            # Delete all shapes for this whiteboard from database
            result = self._db.query(models.WhiteboardShape).filter(
                models.WhiteboardShape.whiteboard_id == self.whiteboard_id
            ).delete(synchronize_session=False)
            self._db.commit()
            # Clear in-memory shapes
            self.shapes = []
            logger.info(f"Cleared all shapes for whiteboard {self.whiteboard_id}. Rows affected: {result}")
        except Exception as e:
            logger.error(f"Error clearing shapes from database: {str(e)}")
            self._db.rollback()

    async def connect(self, websocket: WebSocket, user: Optional[models.User] = None, db: Session = None):
        try:
            # Ensure we have a whiteboard ID
            if not self.whiteboard_id and db:
                await self.get_or_create_whiteboard(db)
                
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
            logger.info(f"Sending initial state to new client on whiteboard {self.whiteboard_id}")
            await websocket.send_text(state_message)
        except Exception as e:
            logger.error(f"Error in connect: {str(e)}")
            raise

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

            if message_type == 'cursor_move':
                if not current_user:
                    logger.warning("Received cursor_move from unauthenticated user")
                    return
                    
                username = current_user.username
                if payload.get('remove'):
                    await self.cleanup_user(username)
                    return
                else:
                    cursor_data = {
                        **payload,
                        'id': username,
                        'username': username,
                        'websocket': exclude_websocket,
                        'user': current_user
                    }
                    self.user_cursors[username] = cursor_data
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
                    await self._broadcast_message(cursor_message, exclude_websocket)
                return

            elif message_type == 'shape_add':
                # Only track shape in memory during drawing
                self.shapes.append(payload)
                await self._broadcast_message(message)

            elif message_type == 'shape_update':
                for i, shape in enumerate(self.shapes):
                    if shape.get('id') == payload.get('id'):
                        self.shapes[i] = payload
                        # Only save to database if it's a final update
                        if payload.get('final'):
                            await self.save_shape(payload)
                        await self._broadcast_message(message)
                        break

            elif message_type == 'shape_delete':
                shape_ids = payload.get('ids', [])
                logger.info(f"Received shape_delete request for IDs: {shape_ids}")
                
                # Delete from database first
                for shape_id in shape_ids:
                    await self.delete_shape(shape_id)
                    logger.info(f"Deleted shape {shape_id} from database")
                
                # Then update in-memory shapes
                self.shapes = [s for s in self.shapes if s.get('id') not in shape_ids]
                logger.info(f"Updated in-memory shapes. Remaining shapes: {len(self.shapes)}")
                
                # Broadcast the deletion to all clients
                await self._broadcast_message(message)
                logger.info("Broadcasted shape deletion to all clients")

            elif message_type == 'clear':
                # Clear all shapes from both memory and database
                await self.clear_all_shapes()
                logger.info("Cleared all shapes")
                await self._broadcast_message(message)

            elif message_type == 'request_state':
                logger.info("Received state request")
                # Load shapes from database
                if self._db and self.whiteboard_id:
                    db_shapes = self._db.query(models.WhiteboardShape).filter(
                        models.WhiteboardShape.whiteboard_id == self.whiteboard_id
                    ).all()
                    self.shapes = [shape.shape_data for shape in db_shapes]
                    logger.info(f"Loaded {len(self.shapes)} shapes from database")
                
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

    async def update_shape(self, shape: dict):
        """Update a shape in the database"""
        if not self._db or not self.whiteboard_id:
            logger.error("Cannot update shape: no database session or whiteboard ID")
            return

        try:
            # Find and update the shape
            db_shape = self._db.query(models.WhiteboardShape).filter(
                models.WhiteboardShape.whiteboard_id == self.whiteboard_id,
                models.WhiteboardShape.shape_data['id'].astext == str(shape['id'])
            ).first()

            if db_shape:
                db_shape.shape_data = shape
                self._db.commit()
                logger.info(f"Updated shape {shape['id']} in database")
            else:
                # If shape doesn't exist, create it
                await self.save_shape(shape)
        except Exception as e:
            logger.error(f"Error updating shape in database: {str(e)}")
            self._db.rollback()

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
    
    await manager.connect(websocket, user, db)
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