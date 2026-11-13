import { campusMap } from '@campus/map-data/campus';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildWorld } from '../world/buildWorld';
import { CameraRig } from './CameraRig';

const world = buildWorld(campusMap);

const settle = (rig: CameraRig, camera: PerspectiveCamera, feet: Vector3) => {
  for (let i = 0; i < 120; i++) rig.update(1 / 60, camera, feet, world.bvh);
};

describe('CameraRig', () => {
  it('sits behind and above the character in the open', () => {
    const rig = new CameraRig();
    rig.heading = 0; // looking towards +Z, so the camera is on the -Z side
    const camera = new PerspectiveCamera(60, 16 / 9);
    const feet = new Vector3(0, 0, -50);
    settle(rig, camera, feet);
    expect(rig.armLength).toBeCloseTo(rig.distance, 1);
    expect(camera.position.z).toBeLessThan(feet.z - 3);
    expect(camera.position.y).toBeGreaterThan(feet.y + 1.5);
  });

  it('is pulled in front of a wall that would hide the character', () => {
    const rig = new CameraRig();
    // Standing just inside the north door's neighbouring wall, looking into the building.
    rig.heading = 0;
    rig.pitch = 0.1;
    const camera = new PerspectiveCamera(60, 16 / 9);
    const feet = new Vector3(20, 0, -33);
    settle(rig, camera, feet);
    expect(rig.armLength).toBeLessThan(2);
    expect(camera.position.z).toBeGreaterThan(-34.6);
  });

  it('clamps pitch and zoom to their limits', () => {
    const rig = new CameraRig();
    rig.look(0, 100_000, 100_000);
    expect(rig.pitch).toBeCloseTo(1.22);
    expect(rig.distance).toBe(8);
    rig.look(0, -100_000, -100_000);
    expect(rig.pitch).toBeCloseTo(-0.17);
    expect(rig.distance).toBe(2);
  });

  it('widens the view on a portrait screen', () => {
    const rig = new CameraRig();
    const camera = new PerspectiveCamera(60, 9 / 19.5);
    rig.update(1 / 60, camera, new Vector3(0, 0, -50), world.bvh);
    expect(camera.fov).toBe(70);
  });
});
