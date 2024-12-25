import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Star, Image as KonvaImage, Group, Text } from 'react-konva';
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
  userId?: string;
};

type WebSocketMessage = {
  type: 'cursor_move' | 'shape_add' | 'shape_update' | 'shape_delete' | 'clear';
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

  useEffect(() => {
    // Connect to WebSocket
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      console.log('Connected to WebSocket server');
    };

    wsRef.current.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      switch (message.type) {
        case 'cursor_move':
          const cursor = message.payload;
          if (cursor.id !== userId) {
            setCursors(prevCursors => {
              const filtered = prevCursors.filter(c => c.id !== cursor.id);
              return [...filtered, cursor];
            });
          }
          break;
        case 'shape_add':
          const newShape = message.payload;
          if (newShape.userId !== userId) {
            setShapes(prevShapes => [...prevShapes, newShape]);
          }
          break;
        case 'shape_update':
          const updatedShape = message.payload;
          if (updatedShape.userId !== userId) {
            setShapes(prevShapes => {
              const filtered = prevShapes.filter(s => s.id !== updatedShape.id);
              return [...filtered, updatedShape];
            });
          }
          break;
        case 'shape_delete':
          const deletedShapeIds = message.payload;
          if (deletedShapeIds.userId !== userId) {
            setShapes(prevShapes => 
              prevShapes.filter(shape => !deletedShapeIds.includes(shape.id))
            );
          }
          break;
        case 'clear':
          if (message.payload.userId !== userId) {
            setShapes([]);
          }
          break;
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [userId]);

  const sendToWebSocket = (message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawing(true);
    setStartPos(pos);
    setEraserPos(pos);

    if (selectedTool === 'eraser') {
      eraseShapesAtPosition(pos.x, pos.y);
      return;
    }

    const newShape: Shape = {
      id: Date.now().toString(),
      type: selectedTool,
      x: pos.x,
      y: pos.y,
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
    const pos = e.target.getStage().getPointerPosition();
    setEraserPos(pos);

    // Send cursor position
    const cursorData: Cursor = {
      id: userId,
      x: pos.x,
      y: pos.y,
      color: userColor,
      username: 'User ' + userId.slice(-4),
    };
    sendToWebSocket({ type: 'cursor_move', payload: cursorData });

    if (selectedTool === 'eraser' && isDrawing) {
      eraseShapesAtPosition(pos.x, pos.y);
      return;
    }

    if (!isDrawing) return;

    const lastShape = shapes[shapes.length - 1];
    let updatedShape = { ...lastShape };

    if (lastShape.type === 'rectangle') {
      updatedShape = {
        ...lastShape,
        width: pos.x - startPos.x,
        height: pos.y - startPos.y,
      };
    } else if (lastShape.type === 'circle') {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      updatedShape = {
        ...lastShape,
        radius: Math.sqrt(dx * dx + dy * dy),
      };
    } else if (lastShape.type === 'star') {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      updatedShape = {
        ...lastShape,
        innerRadius: radius * 0.5,
        outerRadius: radius,
      };
    }

    setShapes([...shapes.slice(0, -1), updatedShape]);
    sendToWebSocket({ type: 'shape_update', payload: updatedShape });
  };

  const eraseShapesAtPosition = (x: number, y: number) => {
    const shapesToDelete: string[] = [];
    const remainingShapes = shapes.filter(shape => {
      const shouldDelete = (() => {
        if (shape.type === 'rectangle' || shape.type === 'image') {
          return x >= shape.x && 
                 x <= shape.x + shape.width && 
                 y >= shape.y && 
                 y <= shape.y + shape.height;
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
          width={window.innerWidth - 200}
          height={window.innerHeight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => setIsDrawing(false)}
          ref={stageRef}
        >
          <Layer>
            {shapes.map((shape) => {
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
                x={eraserPos.x}
                y={eraserPos.y}
                radius={10}
                fill="rgba(255, 0, 0, 0.2)"
                stroke="red"
                strokeWidth={1}
              />
            )}
            {cursors.map(cursor => (
              <Group key={cursor.id}>
                <Circle
                  x={cursor.x}
                  y={cursor.y}
                  radius={5}
                  fill={cursor.color}
                />
                <Rect
                  x={cursor.x + 10}
                  y={cursor.y + 10}
                  width={70}
                  height={20}
                  fill="white"
                  stroke={cursor.color}
                  strokeWidth={1}
                  cornerRadius={5}
                />
                <Text
                  x={cursor.x + 15}
                  y={cursor.y + 15}
                  text={cursor.username}
                  fontSize={12}
                  fill={cursor.color}
                />
              </Group>
            ))}
          </Layer>
        </Stage>
      </Canvas>
    </WhiteboardContainer>
  );
};

export default Whiteboard;