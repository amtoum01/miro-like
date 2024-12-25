import React, { useEffect, useState, useRef } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import styled from 'styled-components';

const WhiteboardContainer = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: white;
`;

const ToolBar = styled.div`
  position: fixed;
  top: 20px;
  left: 20px;
  display: flex;
  gap: 10px;
  background-color: white;
  padding: 10px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const Button = styled.button`
  padding: 8px 16px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: #0056b3;
  }

  &.active {
    background-color: #0056b3;
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

interface WhiteboardProps {
  boardId: string;
  token: string;
}

const Whiteboard: React.FC<WhiteboardProps> = ({ boardId, token }) => {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [newShape, setNewShape] = useState<Shape | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:8000/ws/${boardId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'shape_update') {
        setShapes(data.shapes);
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [boardId]);

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawing(true);
    setStartPos({ x: pos.x, y: pos.y });

    const newShapeData: Shape = {
      id: Math.random().toString(),
      type: 'rectangle',
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
    };

    setNewShape(newShapeData);
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || !newShape) return;

    const pos = e.target.getStage().getPointerPosition();
    const width = pos.x - startPos.x;
    const height = pos.y - startPos.y;

    setNewShape({
      ...newShape,
      width,
      height,
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !newShape || !wsRef.current) return;

    setIsDrawing(false);
    setShapes([...shapes, newShape]);
    
    // Send the new shape to the server
    wsRef.current.send(JSON.stringify({
      type: 'shape_update',
      shape: newShape,
    }));

    setNewShape(null);
  };

  return (
    <WhiteboardContainer>
      <ToolBar>
        <Button>Rectangle</Button>
        <Button onClick={() => setShapes([])}>Clear</Button>
      </ToolBar>
      <Stage
        width={window.innerWidth}
        height={window.innerHeight}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
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
          {newShape && (
            <Rect
              x={newShape.x}
              y={newShape.y}
              width={newShape.width}
              height={newShape.height}
              stroke="#000"
              strokeWidth={2}
            />
          )}
        </Layer>
      </Stage>
    </WhiteboardContainer>
  );
};

export default Whiteboard; 