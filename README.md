# Collaborative Whiteboard Application

A real-time collaborative whiteboard application built with React and FastAPI.

## Features

- User Authentication (Register/Login)
- Real-time Rectangle Drawing
- Collaborative Drawing with Multiple Users
- WebSocket-based Real-time Updates
- Cursor Position Sharing
- Simple Undo/Redo System

## Tech Stack

### Frontend
- React with TypeScript
- React Router for navigation
- Styled Components for styling
- React Konva for canvas drawing
- WebSocket for real-time communication

### Backend
- FastAPI (Python)
- SQLite Database
- SQLAlchemy ORM
- JWT Authentication
- WebSocket for real-time updates

## Setup

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment:
   ```bash
   python -m venv venv
   ```

3. Activate the virtual environment:
   ```bash
   source venv/bin/activate  # On Unix/macOS
   # or
   .env\Scriptsctivate  # On Windows
   ```

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. Run the server:
   ```bash
   ./run.sh
   # or
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

## Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Register a new account or login with existing credentials
3. Start drawing on the whiteboard using the rectangle tool
4. Share the board URL with others to collaborate in real-time

## Development

The application is set up for local development with hot-reloading enabled for both frontend and backend.

- Frontend development server runs on `http://localhost:3000`
- Backend API server runs on `http://localhost:8000`
- API documentation is available at `http://localhost:8000/docs`