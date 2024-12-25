import React, { useEffect, useState, useRef } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import styled from 'styled-components';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
`;

const Toolbar = styled.div`
  padding: 1rem;
  background-color: #f5f5f5;
  border-bottom: 1px solid #ddd;
  display: flex;
  gap: 1rem;
`;

const Button = styled.button`
  padding: 0.5rem 1rem;
  background-color: #0066cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: #0052a3;
  }

  &.active {
    background-color: #004080;
  }
`;

interface Shape {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const Whiteboard: React.FC = () => {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentShape, setCurrentShape] = useState<Shape | null>(null);
  const stageRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket server
    const ws = new WebSocket('ws://localhost:8000/ws');
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'shape_update') {
        setShapes((prevShapes) => [...prevShapes, data.shape]);
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawing(true);
    setStartPos({ x: pos.x, y: pos.y });

    const newShape: Shape = {
      id: Math.random().toString(),
      type: 'rectangle',
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
    };

    setCurrentShape(newShape);
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !currentShape) return;

    const pos = e.target.getStage().getPointerPosition();
    const newShape = {
      ...currentShape,
      width: pos.x - startPos.x,
      height: pos.y - startPos.y,
    };

    setCurrentShape(newShape);
  };

  const handleMouseUp = () => {
    if (!isDrawing || !currentShape || !wsRef.current) return;

    setIsDrawing(false);
    setShapes([...shapes, currentShape]);
    setCurrentShape(null);

    // Send shape to server
    wsRef.current.send(JSON.stringify({
      type: 'shape_update',
      shape: currentShape,
    }));
  };

  return (
    <Container>
      <Toolbar>
        <Button className="active">Rectangle</Button>
      </Toolbar>
      <Stage
        width={window.innerWidth}
        height={window.innerHeight - 64}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        ref={stageRef}
      >
        <Layer>
          {shapes.map((shape) => (
            <Rect
              key={shape.id}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              stroke="#000"
              strokeWidth={2}
            />
          ))}
          {currentShape && (
            <Rect
              x={currentShape.x}
              y={currentShape.y}
              width={currentShape.width}
              height={currentShape.height}
              stroke="#000"
              strokeWidth={2}
            />
          )}
        </Layer>
      </Stage>
    </Container>
  );
};

export default Whiteboard;