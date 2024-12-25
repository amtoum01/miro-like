import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Star, Image as KonvaImage, Group } from 'react-konva';
import styled from 'styled-components';

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
};

const Whiteboard: React.FC = () => {
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedTool, setSelectedTool] = useState<Shape['type']>('rectangle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const stageRef = useRef<any>(null);

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    setIsDrawing(true);
    setStartPos(pos);

    if (selectedTool === 'eraser') {
      // Check if eraser intersects with any shape
      const eraserX = pos.x;
      const eraserY = pos.y;
      const eraserSize = 20;

      const remainingShapes = shapes.filter(shape => {
        // Simple intersection check based on shape type
        if (shape.type === 'rectangle' || shape.type === 'image') {
          return !(eraserX >= shape.x && 
                  eraserX <= shape.x + shape.width && 
                  eraserY >= shape.y && 
                  eraserY <= shape.y + shape.height);
        } else if (shape.type === 'circle') {
          const dx = eraserX - shape.x;
          const dy = eraserY - shape.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance > (shape.radius || 0);
        } else if (shape.type === 'star') {
          const dx = eraserX - shape.x;
          const dy = eraserY - shape.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance > (shape.outerRadius || 0);
        }
        return true;
      });

      setShapes(remainingShapes);
      return;
    }

    const newShape: Shape = {
      id: Date.now().toString(),
      type: selectedTool,
      x: pos.x,
      y: pos.y,
      width: 0,
      height: 0,
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
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing || selectedTool === 'eraser') return;

    const pos = e.target.getStage().getPointerPosition();
    const lastShape = shapes[shapes.length - 1];

    if (lastShape.type === 'rectangle') {
      const newWidth = pos.x - startPos.x;
      const newHeight = pos.y - startPos.y;
      const updatedShape = {
        ...lastShape,
        width: newWidth,
        height: newHeight,
      };
      setShapes([...shapes.slice(0, -1), updatedShape]);
    } else if (lastShape.type === 'circle') {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const updatedShape = {
        ...lastShape,
        radius,
      };
      setShapes([...shapes.slice(0, -1), updatedShape]);
    } else if (lastShape.type === 'star') {
      const dx = pos.x - startPos.x;
      const dy = pos.y - startPos.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const updatedShape = {
        ...lastShape,
        innerRadius: radius * 0.5,
        outerRadius: radius,
      };
      setShapes([...shapes.slice(0, -1), updatedShape]);
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    setShapes([]);
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
          onMouseUp={handleMouseUp}
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
            {selectedTool === 'eraser' && isDrawing && (
              <Circle
                x={startPos.x}
                y={startPos.y}
                radius={10}
                fill="rgba(255, 0, 0, 0.2)"
                stroke="red"
                strokeWidth={1}
              />
            )}
          </Layer>
        </Stage>
      </Canvas>
    </WhiteboardContainer>
  );
};

export default Whiteboard;