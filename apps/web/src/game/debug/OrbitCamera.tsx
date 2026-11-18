import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { useDebugStore, type ViewpointId } from './debugStore';

type Triple = [x: number, y: number, z: number];

const VIEWPOINTS: Record<ViewpointId, { position: Triple; target: Triple }> = {
  overview: { position: [-40, 150, 215], target: [-35, 0, 12] },
  gate: { position: [30, 12, 78], target: [18, 4, 36] },
  lobby: { position: [31, 3.2, 33], target: [20, 1.2, 18] },
  atrium: { position: [7, 3.4, 11], target: [-6, 2.6, -6] },
  bleachers: { position: [-9, 7.2, -11.5], target: [-6, 3, 13] },
  canteen: { position: [44, 3, 8], target: [18, 0.8, -26] },
  gym: { position: [-75, 3, -15], target: [-100, 0.8, -31] },
  office: { position: [14, 7.8, 13], target: [21, 6, -6] },
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
