import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { BackSide, Color, type Mesh, ShaderMaterial } from 'three';
import { PALETTE } from './palette';

const RADIUS = 900;

const vertexShader = /* glsl */ `
  varying float vHeight;
  void main() {
    vHeight = normalize(position).y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  varying float vHeight;
  void main() {
    float t = pow(clamp(vHeight, 0.0, 1.0), 0.55);
    gl_FragColor = vec4(mix(horizon, top, t), 1.0);
    #include <colorspace_fragment>
  }
`;

/** A gradient dome that follows the camera. One draw call, no textures. */
export function Sky() {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          top: { value: new Color(PALETTE.skyTop) },
          horizon: { value: new Color(PALETTE.skyHorizon) },
        },
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );

  useFrame(({ camera }) => {
    if (!mesh.current) return;
    mesh.current.position.copy(camera.position);
    // Stay inside the far plane, which follows the quality setting.
    mesh.current.scale.setScalar((((camera as { far?: number }).far ?? 1000) * 0.9) / RADIUS);
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[RADIUS, 24, 12]} />
    </mesh>
  );
}
