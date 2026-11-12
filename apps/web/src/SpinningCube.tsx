import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

/** Placeholder scene content. Rotation lives in a ref, never in React state. */
export function SpinningCube() {
  const mesh = useRef<Mesh>(null);
  // World-space width of the view at the cube's depth; keeps the cube inside a portrait screen.
  const viewWidth = useThree((state) => state.viewport.width);
  const size = Math.min(1.6, viewWidth * 0.4);

  useFrame((_, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.x += delta * 0.4;
    mesh.current.rotation.y += delta * 0.7;
  });

  return (
    <mesh ref={mesh} scale={size}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#f58220" roughness={0.45} />
    </mesh>
  );
}
