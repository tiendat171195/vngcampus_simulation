import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { statsSink } from './debug/debugStore';
import { OrbitCamera } from './debug/OrbitCamera';
import { CampusWorld } from './world/CampusWorld';
import { PALETTE } from './world/palette';
import { Sky } from './world/Sky';

/**
 * Late-morning sun from over the river (compass bearing 150°, 50° above the horizon), expressed
 * in the campus frame where +X is bearing 38° and +Z is bearing 128°.
 */
const SUN_POSITION: [number, number, number] = [-72, 230, 179];

/** Writes renderer numbers into the debug overlay twice a second, bypassing React. */
function StatsSampler() {
  const gl = useThree((state) => state.gl);
  const window = useRef({ seconds: 0, frames: 0 });

  useFrame((_, delta) => {
    const sample = window.current;
    sample.seconds += delta;
    sample.frames += 1;
    if (sample.seconds < 0.5) return;
    const { calls, triangles } = gl.info.render;
    if (statsSink.element) {
      const fps = Math.round(sample.frames / sample.seconds);
      statsSink.element.textContent = `${fps} FPS · ${calls} draw call · ${(triangles / 1000).toFixed(1)}k tam giác`;
    }
    sample.seconds = 0;
    sample.frames = 0;
  });

  return null;
}

export function GameCanvas() {
  return (
    <div className="scene">
      <Canvas
        camera={{ fov: 55, near: 0.5, far: 2000, position: [-40, 150, 215] }}
        dpr={[1, 2]}
        flat
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[PALETTE.skyHorizon]} />
        <fog attach="fog" args={[PALETTE.skyHorizon, 220, 900]} />
        <ambientLight intensity={0.7} />
        <hemisphereLight args={[PALETTE.skylight, PALETTE.groundBounce, 0.9]} />
        <directionalLight position={SUN_POSITION} intensity={2} color={PALETTE.sunlight} />
        <Sky />
        <CampusWorld />
        <OrbitCamera />
        <StatsSampler />
      </Canvas>
    </div>
  );
}
