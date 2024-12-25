import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Star, Group, Text } from 'react-konva';
import styled from 'styled-components';
import { WS_URL } from '../../config';

const WhiteboardContainer = styled.div`
  display: flex;
  height: 100vh;
`;

const Toolbar = styled.div`
  width: 200px;
  background-color: #f5f5f5;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ToolButton = styled.button<{ active?: boolean }>`
  padding: 10px;
  border: none;
  border-radius: 5px;
  background-color: ${props => props.active ? '#007bff' : '#fff'};
  color: ${props => props.active ? '#fff' : '#000'};
  cursor: pointer;
  &:hover {
    background-color: ${props => props.active ? '#0056b3' : '#e9ecef'};
  }
`;

const Canvas = styled.div`
  flex: 1;
  background-color: #fff;
`;

type Cursor = {
  id: string;
  x: number;
  y: number;
  color: string;
  username: string;
};

type Shape = {
  id: string;
  type: 'rectangle' | 'circle' | 'star' | 'image' | 'eraser';
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  numPoints?: number;
  innerRadius?: number;
  outerRadius?: number;
  imageUrl?: string;
  userId: string;
};

type WebSocketMessage = {
  type: 'cursor_move' | 'shape_add' | 'shape_update' | 'shape_delete' | 'clear' | 'request_state' | 'current_state';
  payload: any;
};

const getRandomColor = () => {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5'];
  return colors[Math.floor(Math.random() * colors.length)];
};

const Whiteboard: React.FC = () => {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedTool, setSelectedTool] = useState<Shape['type']>('rectangle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [eraserPos, setEraserPos] = useState({ x: 0, y: 0 });
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [userId] = useState<string>(Date.now().toString());
  const [userColor] = useState<string>(getRandomColor());
  const stageRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastCursorUpdate = useRef<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;

  const connectWebSocket = () => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }

    // Get the authentication token from localStorage
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('No authentication token found');
      return;
    }

    // Append token to WebSocket URL
    const wsUrlWithAuth = `${WS_URL}?token=${encodeURIComponent(token)}`;
    console.log('Connecting to WebSocket at:', wsUrlWithAuth);
    wsRef.current = new WebSocket(wsUrlWithAuth);

    wsRef.current.onopen = () => {
      console.log('Connected to WebSocket server');
      reconnectAttemptsRef.current = 0;
      
      // Request current state first
      sendToWebSocket({ type: 'request_state', payload: { userId } });
      
      // Then send initial cursor position
      const initialCursor: Cursor = {
        id: userId,
        x: 0,
        y: 0,
        color: userColor,
        username: 'User ' + userId.slice(-4),
      };
      sendToWebSocket({ type: 'cursor_move', payload: initialCursor });
    };

    wsRef.current.onclose = () => {
      console.log('Disconnected from WebSocket server');
      // Remove disconnected cursors
      setCursors(prevCursors => prevCursors.filter(c => c.id !== userId));
      
      // Try to reconnect after a delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptsRef.current++;
        connectWebSocket();
      }, 3000); // Retry after 3 seconds
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current.onmessage = (event) => {
      console.log('Received WebSocket message:', event.data);
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        console.log('Parsed message:', message);
        
        switch (message.type) {
          case 'cursor_move':
            const cursor = message.payload;
            console.log('Processing cursor_move:', cursor);
            if (cursor.id !== userId) {
              console.log('Received cursor update for other user:', cursor);
              if (cursor.remove) {
                console.log('Removing cursor for user:', cursor.id);
                setCursors(prevCursors => {
                  console.log('Previous cursors:', prevCursors);
                  const newCursors = prevCursors.filter((c: Cursor) => c.id !== cursor.id);
                  console.log('New cursors after removal:', newCursors);
                  return newCursors;
                });
              } else {
                console.log('Adding/updating cursor for user:', cursor.id);
                setCursors(prevCursors => {
                  console.log('Previous cursors:', prevCursors);
                  const filtered = prevCursors.filter((c: Cursor) => c.id !== cursor.id);
                  const newCursors = [...filtered, cursor];
                  console.log('New cursors after update:', newCursors);
                  return newCursors;
                });
              }
            } else {
              console.log('Ignoring cursor update for self');
            }
            break;
          case 'shape_add':
            const newShape = message.payload;
            setShapes(prevShapes => [...prevShapes, newShape]);
            break;
          case 'shape_update':
            const updatedShape = message.payload;
            setShapes(prevShapes => {
              const filtered = prevShapes.filter(s => s.id !== updatedShape.id);
              return [...filtered, updatedShape];
            });
            break;
          case 'shape_delete':
            const { ids } = message.payload;
            setShapes(prevShapes => 
              prevShapes.filter(shape => !ids.includes(shape.id))
            );
            break;
          case 'clear':
            setShapes([]);
            break;
          case 'current_state':
            console.log('Received current state:', message.payload);
            const { shapes: currentShapes, cursors: currentCursors } = message.payload;
            console.log('Current cursors from state:', currentCursors);
            if (currentShapes) {
              setShapes(currentShapes);
            }
            if (currentCursors) {
              // Keep our cursor and add other cursors
              setCursors(prevCursors => {
                console.log('Previous cursors before state update:', prevCursors);
                const ourCursor = prevCursors.find((c: Cursor) => c.id === userId);
                console.log('Our cursor:', ourCursor);
                const otherCursors = currentCursors.filter((c: Cursor) => c.id !== userId);
                console.log('Other cursors:', otherCursors);
                const newCursors = [...otherCursors, ...(ourCursor ? [ourCursor] : [])];
                console.log('New cursors after state update:', newCursors);
                return newCursors;
              });
            }
            break;
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
  };

  useEffect(() => {
    connectWebSocket();

    return () => {
      console.log('Cleaning up WebSocket connection');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      // Clear cursors when component unmounts
      setCursors([]);
    };
  }, [userId, userColor]);

  const sendToWebSocket = (message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('Sending WebSocket message:', message);
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
    }
  };

  const handleMouseDown = (e: any) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;

    setIsDrawing(true);
    setStartPos({ x: pos.x || 0, y: pos.y || 0 });
    setEraserPos({ x: pos.x || 0, y: pos.y || 0 });

    if (selectedTool === 'eraser') {
      eraseShapesAtPosition(pos.x || 0, pos.y || 0);
      return;
    }

    const newShape: Shape = {
      id: Date.now().toString(),
      type: selectedTool,
      x: pos.x || 0,
      y: pos.y || 0,
      width: 0,
      height: 0,
      userId,
    };

    if (selectedTool === 'circle') {
      newShape.radius = 0;
    } else if (selectedTool === 'star') {
      newShape.numPoints = 5;
      newShape.innerRadius = 0;
      newShape.outerRadius = 0;
    } else if (selectedTool === 'image') {
      newShape.width = 100;
      newShape.height = 100;
      newShape.imageUrl = 'placeholder';
    }

    setShapes([...shapes, newShape]);
    sendToWebSocket({ type: 'shape_add', payload: newShape });
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;

    setEraserPos({ x: pos.x || 0, y: pos.y || 0 });

    // Send cursor position
    const cursorData: Cursor = {
      id: userId,
      x: pos.x || 0,
      y: pos.y || 0,
      color: userColor,
      username: 'User ' + userId.slice(-4),
    };
    
    // Update local cursor state immediately
    setCursors(prevCursors => {
      console.log('Updating local cursor state. Previous cursors:', prevCursors);
      const filtered = prevCursors.filter((c: Cursor) => c.id !== userId);
      const newCursors = [...filtered, cursorData];
      console.log('New cursor state:', newCursors);
      return newCursors;
    });
    
    // Send cursor updates more frequently
    const now = Date.now();
    if (!lastCursorUpdate.current || now - lastCursorUpdate.current > 30) {
      console.log('Sending cursor update:', cursorData);
      sendToWebSocket({ type: 'cursor_move', payload: cursorData });
      lastCursorUpdate.current = now;
    }

    if (selectedTool === 'eraser' && isDrawing) {
      eraseShapesAtPosition(pos.x || 0, pos.y || 0);
      return;
    }

    if (!isDrawing) return;

    const lastShape = shapes[shapes.length - 1];
    if (!lastShape) return;

    let updatedShape = { ...lastShape };

    if (lastShape.type === 'rectangle') {
      const width = (pos.x || 0) - (startPos.x || 0);
      const height = (pos.y || 0) - (startPos.y || 0);
      
      // Adjust position for negative dimensions
      updatedShape = {
        ...lastShape,
        x: width < 0 ? pos.x : startPos.x,
        y: height < 0 ? pos.y : startPos.y,
        width: Math.abs(width),
        height: Math.abs(height),
      };
    } else if (lastShape.type === 'circle') {
      const dx = (pos.x || 0) - (startPos.x || 0);
      const dy = (pos.y || 0) - (startPos.y || 0);
      updatedShape = {
        ...lastShape,
        radius: Math.sqrt(dx * dx + dy * dy),
      };
    } else if (lastShape.type === 'star') {
      const dx = (pos.x || 0) - (startPos.x || 0);
      const dy = (pos.y || 0) - (startPos.y || 0);
      const radius = Math.sqrt(dx * dx + dy * dy);
      updatedShape = {
        ...lastShape,
        innerRadius: radius * 0.4,
        outerRadius: radius,
      };
    }

    setShapes(prevShapes => [...prevShapes.slice(0, -1), updatedShape]);
    sendToWebSocket({ type: 'shape_update', payload: updatedShape });
  };

  const eraseShapesAtPosition = (x: number, y: number) => {
    const shapesToDelete: string[] = [];
    const remainingShapes = shapes.filter(shape => {
      const shouldDelete = (() => {
        if (shape.type === 'rectangle' || shape.type === 'image') {
          return x >= shape.x && 
                 x <= shape.x + (shape.width || 0) && 
                 y >= shape.y && 
                 y <= shape.y + (shape.height || 0);
        } else if (shape.type === 'circle') {
          const dx = x - shape.x;
          const dy = y - shape.y;
          return Math.sqrt(dx * dx + dy * dy) <= (shape.radius || 0);
        } else if (shape.type === 'star') {
          const dx = x - shape.x;
          const dy = y - shape.y;
          return Math.sqrt(dx * dx + dy * dy) <= (shape.outerRadius || 0);
        }
        return false;
      })();

      if (shouldDelete) {
        shapesToDelete.push(shape.id);
      }
      return !shouldDelete;
    });

    if (shapesToDelete.length > 0) {
      setShapes(remainingShapes);
      sendToWebSocket({ 
        type: 'shape_delete', 
        payload: { ids: shapesToDelete, userId } 
      });
    }
  };

  const handleClear = () => {
    setShapes([]);
    sendToWebSocket({ type: 'clear', payload: { userId } });
  };

  return (
    <WhiteboardContainer>
      <Toolbar>
        <ToolButton
          active={selectedTool === 'rectangle'}
          onClick={() => setSelectedTool('rectangle')}
        >
          Rectangle
        </ToolButton>
        <ToolButton
          active={selectedTool === 'circle'}
          onClick={() => setSelectedTool('circle')}
        >
          Circle
        </ToolButton>
        <ToolButton
          active={selectedTool === 'star'}
          onClick={() => setSelectedTool('star')}
        >
          Star
        </ToolButton>
        <ToolButton
          active={selectedTool === 'image'}
          onClick={() => setSelectedTool('image')}
        >
          Image
        </ToolButton>
        <ToolButton
          active={selectedTool === 'eraser'}
          onClick={() => setSelectedTool('eraser')}
        >
          Eraser
        </ToolButton>
        <ToolButton onClick={handleClear}>
          Clear All
        </ToolButton>
      </Toolbar>
      <Canvas>
        <Stage
          width={Math.max(0, window.innerWidth - 200)}
          height={Math.max(0, window.innerHeight)}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => {
            setIsDrawing(false);
            const lastShape = shapes[shapes.length - 1];
            if (lastShape) {
              sendToWebSocket({ type: 'shape_update', payload: lastShape });
            }
          }}
          onMouseLeave={() => {
            setIsDrawing(false);
            const lastShape = shapes[shapes.length - 1];
            if (lastShape) {
              sendToWebSocket({ type: 'shape_update', payload: lastShape });
            }
            console.log('Mouse left canvas, removing cursor');
            sendToWebSocket({
              type: 'cursor_move',
              payload: { id: userId, remove: true }
            });
          }}
          ref={stageRef}
        >
          <Layer>
            {shapes.map((shape) => {
              if (!shape || typeof shape.x !== 'number' || typeof shape.y !== 'number') return null;
              if (shape.type === 'rectangle') {
                return (
                  <Rect
                    key={shape.id}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width || 0}
                    height={shape.height || 0}
                    stroke="#000"
                    strokeWidth={2}
                  />
                );
              } else if (shape.type === 'circle') {
                return (
                  <Circle
                    key={shape.id}
                    x={shape.x}
                    y={shape.y}
                    radius={shape.radius || 0}
                    stroke="#000"
                    strokeWidth={2}
                  />
                );
              } else if (shape.type === 'star') {
                return (
                  <Star
                    key={shape.id}
                    x={shape.x}
                    y={shape.y}
                    numPoints={5}
                    innerRadius={shape.innerRadius || 0}
                    outerRadius={shape.outerRadius || 0}
                    stroke="#000"
                    strokeWidth={2}
                    
                  />
                );
              } else if (shape.type === 'image') {
                return (
                  <Group key={shape.id}>
                    <Rect
                      x={shape.x}
                      y={shape.y}
                      width={shape.width || 100}
                      height={shape.height || 100}
                      fill="#e0e0e0"
                      stroke="#000"
                      strokeWidth={2}
                    />
                    <Rect
                      x={shape.x + 10}
                      y={shape.y + 10}
                      width={shape.width - 20 || 80}
                      height={shape.height - 20 || 80}
                      fill="#f5f5f5"
                      stroke="#000"
                      strokeWidth={1}
                      dash={[5, 5]}
                    />
                  </Group>
                );
              }
              return null;
            })}
            {selectedTool === 'eraser' && (
              <Circle
                x={eraserPos.x || 0}
                y={eraserPos.y || 0}
                radius={10}
                fill="rgba(255, 0, 0, 0.2)"
                stroke="red"
                strokeWidth={1}
              />
            )}
            {cursors.map(cursor => {
              console.log('Attempting to render cursor:', cursor);
              if (!cursor || typeof cursor.x !== 'number' || typeof cursor.y !== 'number') {
                console.log('Invalid cursor data:', cursor);
                return null;
              }
              return (
                <Group key={cursor.id}>
                  <Circle
                    x={cursor.x || 0}
                    y={cursor.y || 0}
                    radius={8}
                    fill={cursor.color}
                    shadowColor="black"
                    shadowBlur={2}
                    shadowOffset={{ x: 1, y: 1 }}
                    shadowOpacity={0.4}
                  />
                  <Rect
                    x={(cursor.x || 0) + 10}
                    y={(cursor.y || 0) + 10}
                    width={100}
                    height={24}
                    fill="white"
                    stroke={cursor.color}
                    strokeWidth={2}
                    cornerRadius={5}
                    shadowColor="black"
                    shadowBlur={2}
                    shadowOffset={{ x: 1, y: 1 }}
                    shadowOpacity={0.2}
                  />
                  <Text
                    x={(cursor.x || 0) + 15}
                    y={(cursor.y || 0) + 15}
                    text={cursor.username}
                    fontSize={14}
                    fill={cursor.color}
                    fontStyle="bold"
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </Canvas>
      <div style={{
        position: 'fixed',
        bottom: 10,
        right: 10,
        padding: '10px',
        borderRadius: 5,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        fontSize: 12,
        fontFamily: 'monospace',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
        }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: wsRef.current?.readyState === WebSocket.OPEN ? '#4CAF50' : '#f44336',
          }}></div>
          {wsRef.current?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}
        </div>
        <div>Cursors: {cursors.length}</div>
        <div>Your ID: {userId.slice(-4)}</div>
        <div>Your Color: <span style={{ color: userColor }}>{userColor}</span></div>
        <div>WebSocket State: {wsRef.current?.readyState}</div>
      </div>
    </WhiteboardContainer>
  );
};

export default Whiteboard;