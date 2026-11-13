import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { useDebugStore, type ViewpointId } from './debugStore';

type Triple = [x: number, y: number, z: number];

const VIEWPOINTS: Record<ViewpointId, { position: Triple; target: Triple }> = {
  overview: { position: [-40, 150, 215], target: [-35, 0, 12] },
  gate: { position: [0, 13, -84], target: [0, 3, -34] },
  atrium: { position: [0, 3.2, 14], target: [0, 5, -12] },
  pool: { position: [78, 20, -62], target: [50, 0, -18] },
  riverside: { position: [-70, 9, 104], target: [-25, 2, 40] },
  forecourt: { position: [-92, 26, 84], target: [-55, 2, 18] },
};

/** Free camera for inspecting the world: drag to pan, right-drag or two fingers to rotate. */
export function OrbitCamera() {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const viewpoint = useDebugStore((state) => state.viewpoint);

  const controls = useMemo(() => {
    const instance = new MapControls(camera, domElement);
    instance.enableDamping = true;
    instance.dampingFactor = 0.12;
    instance.minDistance = 2;
    instance.maxDistance = 520;
    instance.maxPolarAngle = Math.PI / 2 - 0.02;
    return instance;
  }, [camera, domElement]);

  useEffect(() => () => controls.dispose(), [controls]);

  useEffect(() => {
    const { position, target } = VIEWPOINTS[viewpoint.id];
    camera.position.set(...position);
    controls.target.set(...target);
    controls.update();
  }, [camera, controls, viewpoint]);

  useFrame(() => {
    controls.update();
  });

  return null;
}
