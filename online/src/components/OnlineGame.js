import { useEffect, useRef, useState } from 'react';

export const OnlineGame = () => {
  const canvasRef = useRef(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const gameStateRef = useRef({
    dino: { x: 50, y: 0, velocityY: 0, isJumping: false },
    obstacles: [],
    ground: 0,
    frameCount: 0,
    gameSpeed: 5,
  });

  const CANVAS_WIDTH = 600;
  const CANVAS_HEIGHT = 200;
  const GROUND_HEIGHT = 150;
  const DINO_WIDTH = 40;
  const DINO_HEIGHT = 44;
  const GRAVITY = 0.6;
  const JUMP_STRENGTH = -12;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = gameStateRef.current;
    state.dino.y = GROUND_HEIGHT;

    let animationFrameId;

    const drawDino = () => {
      const { x, y } = state.dino;
      ctx.fillStyle = '#535353';

      // Body
      ctx.fillRect(x + 10, y, 20, 24);
      // Head
      ctx.fillRect(x + 20, y - 10, 10, 14);
      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 24, y - 6, 2, 2);
      // Legs
      ctx.fillStyle = '#535353';
      const legOffset = Math.floor(state.frameCount / 5) % 2 === 0 ? 0 : 4;
      ctx.fillRect(x + 10, y + 24, 6, 20);
      ctx.fillRect(x + 24 - legOffset, y + 24, 6, 20);
    };

    const drawObstacle = (obstacle) => {
      ctx.fillStyle = '#535353';
      const y = GROUND_HEIGHT + DINO_HEIGHT - obstacle.height;

      // Cactus body
      ctx.fillRect(obstacle.x, y, obstacle.width, obstacle.height);
      // Cactus arms
      if (obstacle.width > 15) {
        ctx.fillRect(obstacle.x - 6, y + 8, 6, 12);
        ctx.fillRect(obstacle.x + obstacle.width, y + 12, 6, 10);
      }
    };

    const drawGround = () => {
      ctx.strokeStyle = '#535353';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_HEIGHT + DINO_HEIGHT);
      ctx.lineTo(CANVAS_WIDTH, GROUND_HEIGHT + DINO_HEIGHT);
      ctx.stroke();

      // Ground dots
      for (let i = 0; i < CANVAS_WIDTH; i += 20) {
        const offset = (state.ground + i) % 40;
        ctx.fillRect(offset, GROUND_HEIGHT + DINO_HEIGHT + 4, 2, 2);
      }
    };

    const checkCollision = () => {
      const dino = state.dino;
      const dinoBox = {
        x: dino.x + 10,
        y: dino.y,
        width: DINO_WIDTH - 10,
        height: DINO_HEIGHT,
      };

      for (const obstacle of state.obstacles) {
        const obstacleBox = {
          x: obstacle.x,
          y: GROUND_HEIGHT + DINO_HEIGHT - obstacle.height,
          width: obstacle.width,
          height: obstacle.height,
        };

        if (
          dinoBox.x < obstacleBox.x + obstacleBox.width &&
          dinoBox.x + dinoBox.width > obstacleBox.x &&
          dinoBox.y < obstacleBox.y + obstacleBox.height &&
          dinoBox.y + dinoBox.height > obstacleBox.y
        ) {
          return true;
        }
      }
      return false;
    };

    const gameLoop = () => {
      if (!hasStarted || isGameOver) return;

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Update dino physics
      if (state.dino.isJumping) {
        state.dino.velocityY += GRAVITY;
        state.dino.y += state.dino.velocityY;

        if (state.dino.y >= GROUND_HEIGHT) {
          state.dino.y = GROUND_HEIGHT;
          state.dino.velocityY = 0;
          state.dino.isJumping = false;
        }
      }

      // Update ground
      state.ground = (state.ground - state.gameSpeed) % 40;

      // Spawn obstacles
      state.frameCount++;
      if (state.frameCount % 100 === 0) {
        const height = 30 + Math.random() * 20;
        const width = 12 + Math.random() * 8;
        state.obstacles.push({
          x: CANVAS_WIDTH,
          width,
          height,
        });
      }

      // Update obstacles
      state.obstacles = state.obstacles.filter((obstacle) => {
        obstacle.x -= state.gameSpeed;
        return obstacle.x > -50;
      });

      // Increase difficulty
      if (state.frameCount % 500 === 0) {
        state.gameSpeed += 0.5;
      }

      // Check collision
      if (checkCollision()) {
        setIsGameOver(true);
        return;
      }

      // Update score
      setScore(Math.floor(state.frameCount / 10));

      // Draw everything
      drawGround();
      drawDino();
      state.obstacles.forEach(drawObstacle);

      // Score
      ctx.fillStyle = '#535353';
      ctx.font = '16px monospace';
      ctx.fillText(
        `Score: ${Math.floor(state.frameCount / 10)}`,
        CANVAS_WIDTH - 120,
        30,
      );

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    if (hasStarted && !isGameOver) {
      gameLoop();
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [hasStarted, isGameOver]);

  const jump = () => {
    if (!hasStarted) {
      setHasStarted(true);
      return;
    }

    if (isGameOver) {
      // Reset game
      gameStateRef.current = {
        dino: { x: 50, y: GROUND_HEIGHT, velocityY: 0, isJumping: false },
        obstacles: [],
        ground: 0,
        frameCount: 0,
        gameSpeed: 5,
      };
      setIsGameOver(false);
      setScore(0);
      setHasStarted(true);
      return;
    }

    const state = gameStateRef.current;
    if (!state.dino.isJumping) {
      state.dino.isJumping = true;
      state.dino.velocityY = JUMP_STRENGTH;
    }
  };

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        jump();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [hasStarted, isGameOver]);

  return (
    <div className='flex flex-col items-center gap-4'>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onClick={jump}
        className='cursor-pointer border-0'
        style={{ imageRendering: 'pixelated' }}
      />
      {!hasStarted && (
        <p className='text-sm text-muted-foreground'>
          Press SPACE or click to start
        </p>
      )}
      {isGameOver && (
        <div className='text-center'>
          <p className='text-lg font-semibold text-foreground mb-2'>
            Game Over! Score: {score}
          </p>
          <p className='text-sm text-muted-foreground'>
            Press SPACE or click to restart
          </p>
        </div>
      )}
    </div>
  );
};
