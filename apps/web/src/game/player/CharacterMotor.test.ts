import { floorAt, pointInPolygon, poisOfSet } from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { MOVEMENT } from '@campus/shared';
import { describe, expect, it } from 'vitest';
import { buildWorld } from '../world/buildWorld';
import { CharacterMotor } from './CharacterMotor';

const world = buildWorld(campusMap);
const DT = 1 / 60;
const IDLE = { x: 0, z: 0, run: false, jump: false };

type Waypoint = [x: number, z: number];

function spawn(x: number, y: number, z: number): CharacterMotor {
  const motor = new CharacterMotor(world.bvh);
  motor.teleport(x, y, z);
  return motor;
}

function wait(motor: CharacterMotor, seconds: number, intent = IDLE): void {
  for (let t = 0; t < seconds; t += DT) motor.step(DT, intent);
}

/** Heads for each waypoint in turn, like a player holding "forward". Returns the seconds taken. */
function follow(motor: CharacterMotor, waypoints: Waypoint[], run = false): number {
  let time = 0;
  for (const [x, z] of waypoints) {
    const deadline = time + 90;
    for (;;) {
      const dx = x - motor.position.x;
      const dz = z - motor.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.4) break;
      if (time > deadline) {
        const at = motor.position.toArray().map((v) => v.toFixed(2));
        throw new Error(`stuck at ${at} on the way to ${x}, ${z}`);
      }
      motor.step(DT, { x: dx / distance, z: dz / distance, run, jump: false });
      time += DT;
    }
  }
  return time;
}

const floorOf = (motor: CharacterMotor) => floorAt(campusIndex, motor.position.y);

describe('standing, falling, jumping', () => {
  it('stays put on flat ground', () => {
    const motor = spawn(0, 0, -52);
    wait(motor, 2);
    expect(motor.grounded).toBe(true);
    expect(motor.position.toArray()).toEqual([0, 0, -52]);
  });

  it('falls under gravity and lands on the ground', () => {
    const motor = spawn(0, 3, -52);
    expect(motor.grounded).toBe(false);
    let time = 0;
    while (!motor.grounded && time < 3) {
      motor.step(DT, IDLE);
      time += DT;
    }
    expect(motor.position.y).toBeCloseTo(0, 3);
    expect(time).toBeCloseTo(Math.sqrt((2 * 3) / -MOVEMENT.gravity), 1);
  });

  it('jumps to the configured height and comes back down', () => {
    const motor = spawn(0, 0, -52);
    motor.step(DT, { ...IDLE, jump: true });
    let peak = 0;
    for (let t = 0; t < 2 && !motor.grounded; t += DT) {
      motor.step(DT, IDLE);
      peak = Math.max(peak, motor.position.y);
    }
    expect(peak).toBeCloseTo(MOVEMENT.jumpHeight, 1);
    expect(motor.grounded).toBe(true);
    expect(motor.position.y).toBeCloseTo(0, 3);
  });

  it('returns to the last safe spot after falling out of the world', () => {
    const motor = spawn(0, 0, -52);
    wait(motor, 0.1);
    motor.position.set(0, -30, -52);
    motor.grounded = false;
    wait(motor, 0.1);
    expect(motor.position.y).toBeGreaterThan(-0.1);
    expect(motor.position.z).toBeCloseTo(-52);
  });
});

describe('speed', () => {
  it.each([
    { run: false, expected: MOVEMENT.walkSpeed },
    { run: true, expected: MOVEMENT.runSpeed },
  ])('covers ground at $expected m/s when run is $run', ({ run, expected }) => {
    const motor = spawn(-100, 0, 76);
    wait(motor, 0.5, { x: 1, z: 0, run, jump: false });
    const from = motor.position.x;
    wait(motor, 2, { x: 1, z: 0, run, jump: false });
    expect((motor.position.x - from) / 2).toBeCloseTo(expected, 1);
  });

  it('does not go faster diagonally', () => {
    const motor = spawn(-100, 0, 76);
    wait(motor, 1, { x: 1, z: 1, run: true, jump: false });
    expect(motor.speed).toBeCloseTo(MOVEMENT.runSpeed, 2);
  });
});

describe('walls, doors and edges', () => {
  it('walks straight from every gate spawn point into the building', () => {
    for (const spawnPoint of poisOfSet(campusIndex, 'players_gate')) {
      const motor = spawn(spawnPoint.position[0], 0, spawnPoint.position[1]);
      wait(motor, 12, { x: 0, z: 1, run: false, jump: false });
      expect(motor.position.z, spawnPoint.id).toBeGreaterThan(-25);
    }
  });

  it('walks in through the north door', () => {
    const motor = spawn(0, 0, -52);
    follow(motor, [[0, -25]]);
    expect(motor.position.z).toBeGreaterThan(-26);
  });

  it('is stopped by a wall, even at a run', () => {
    const motor = spawn(20, 0, -45);
    wait(motor, 4, { x: 0, z: 1, run: true, jump: false });
    expect(motor.position.z).toBeLessThan(-34.7);
    expect(motor.position.z).toBeGreaterThan(-35.2);
  });

  it('slides along a wall when pushed into it at an angle', () => {
    const motor = spawn(20, 0, -36);
    wait(motor, 2, { x: 1, z: 1, run: false, jump: false });
    expect(motor.position.z).toBeLessThan(-34.7);
    expect(motor.position.x).toBeGreaterThan(22);
  });

  it('is kept inside by the fence, also where the gate stands open', () => {
    const motor = spawn(0, 0, -52);
    wait(motor, 6, { x: 0, z: -1, run: true, jump: false });
    expect(motor.position.z).toBeGreaterThan(-57);
  });

  it('cannot walk or jump into the pool', () => {
    const pool = campusIndex.areas.get('area.pool');
    const motor = spawn(57.6, 0, -3.2);
    for (let t = 0; t < 6; t += DT) {
      motor.step(DT, { x: -0.5, z: -0.87, run: true, jump: Math.round(t / DT) % 40 === 0 });
    }
    expect(pool && pointInPolygon([motor.position.x, motor.position.z], pool.polygon)).toBe(false);
  });

  it('cannot leave an upper floor over the atrium railing', () => {
    const motor = spawn(0, 5, -15);
    expect(motor.grounded).toBe(true);
    wait(motor, 4, { x: 0, z: 1, run: true, jump: false });
    expect(motor.position.y).toBeCloseTo(5, 3);
    expect(motor.position.z).toBeLessThan(-12);
  });
});

describe('stairs', () => {
  it('does not creep while standing on a flight', () => {
    const motor = spawn(-8, 2.5, -7);
    expect(motor.grounded).toBe(true);
    wait(motor, 3);
    expect(motor.position.x).toBe(-8);
    expect(motor.position.z).toBe(-7);
    expect(motor.position.y).toBeCloseTo(2.5, 1);
  });

  it('climbs from the gate to the third floor and back without getting stuck', () => {
    const motor = spawn(0, 0, -52);
    const up: Waypoint[] = [
      [0, -30], // through the north door
      [-3, -14], // into the atrium, east of the north stair
      [-3, 0],
      [-8, -0.5], // foot of the stair
      [-8, -13.2], // up to the F2 gallery
    ];
    follow(motor, up);
    expect(motor.position.y).toBeCloseTo(5, 2);
    expect(floorOf(motor)).toBe('F2');

    follow(motor, [
      [6, -14.4], // along the gallery to the next flight
      [6, -27.5], // up to F3
    ]);
    expect(motor.position.y).toBeCloseTo(9.5, 2);
    expect(floorOf(motor)).toBe('F3');
    expect(motor.grounded).toBe(true);

    follow(motor, [
      [6, -14.4],
      [-8, -13.2],
      [-8, -0.5],
    ]);
    expect(motor.position.y).toBeCloseTo(0, 2);
    expect(floorOf(motor)).toBe('F1');
  });

  it('survives the same climb at a run', () => {
    const motor = spawn(-8, 0, 0);
    follow(
      motor,
      [
        [-8, -13.2],
        [6, -14.4],
        [6, -27.5],
      ],
      true,
    );
    expect(motor.position.y).toBeCloseTo(9.5, 2);
  });

  it('reaches the upper floors of block 2 through the link and by its own stairs', () => {
    const block2 = campusIndex.structures.get('structure.block2');
    const motor = spawn(-40, 5, -20);
    follow(motor, [
      [-58.9, -19.9],
      [-63, -21.5],
    ]);
    expect(floorOf(motor)).toBe('F2');
    expect(motor.position.y).toBeCloseTo(5, 2);
    expect(block2 && pointInPolygon([motor.position.x, motor.position.z], block2.footprint)).toBe(
      true,
    );

    const climber = spawn(-95, 0, 2);
    follow(climber, [
      [-95, -11.5],
      [-89, -11.5],
      [-89, 1.5],
    ]);
    expect(climber.position.y).toBeCloseTo(9.5, 2);
  });
});

describe('getting around outside', () => {
  it('walks from the gate round the building to the pool deck', () => {
    const motor = spawn(0, 0, -52);
    const seconds = follow(motor, [
      [45, -50],
      [64.5, -40],
      [64.5, 9],
      [56.5, 7],
    ]);
    expect(motor.grounded).toBe(true);
    expect(motor.position.y).toBeCloseTo(0, 2);
    // Roughly 130 m at walking pace.
    expect(seconds).toBeGreaterThan(45);
    expect(seconds).toBeLessThan(65);
  });

  it('steps over the pool curb height without jumping but not over a wall', () => {
    const motor = spawn(-2, 0, 20);
    wait(motor, 3, { x: 0, z: 1, run: false, jump: false });
    // The koi pond is ringed by a 25 cm curb and an invisible wall: the walk ends at its edge.
    const pond = campusIndex.areas.get('area.koi_pond');
    expect(pond && pointInPolygon([motor.position.x, motor.position.z], pond.polygon)).toBe(false);
    expect(motor.position.y).toBeLessThan(0.3);
  });
});
