import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Stage, Layer, Rect } from 'react-konva';
import { WS_URL } from '../../config';

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
  const [newShape, setNewShape] = useState<Shape | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connect to WebSocket server
    wsRef.current = new WebSocket(WS_URL);

    wsRef.current.onopen = () => {
      console.log('Connected to WebSocket');
    };

    wsRef.current.onmessage = (event) => {
      const shape = JSON.parse(event.data);
      setShapes(prevShapes => [...prevShapes, shape]);
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
    setStartPos(pos);

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
    setShapes(prevShapes => [...prevShapes, newShape]);
    wsRef.current.send(JSON.stringify(newShape));
    setNewShape(null);
  };

  return (
    <Container>
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
    </Container>
  );
};

const Container = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: white;
`;

export default Whiteboard;