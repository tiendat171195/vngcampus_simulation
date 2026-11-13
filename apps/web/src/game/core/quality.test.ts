import { describe, expect, it } from 'vitest';
import { initialRung, LADDER, QualityGovernor } from './quality';

const run = (governor: QualityGovernor, fps: number, seconds: number) => {
  let changes = 0;
  for (let t = 0; t < seconds; t += 1 / fps) if (governor.sample(1 / fps)) changes++;
  return changes;
};

describe('initialRung', () => {
  it('starts software renderers at the bottom and desktops high', () => {
    expect(LADDER[initialRung({ renderer: 'Google SwiftShader', touch: false, cores: 8 })]).toEqual(
      { level: 'low', dpr: 0.75 },
    );
    expect(LADDER[initialRung({ renderer: 'ANGLE (NVIDIA)', touch: false, cores: 8 })]).toEqual({
      level: 'high',
      dpr: 1.5,
    });
    expect(LADDER[initialRung({ renderer: 'Adreno (TM) 619', touch: true, cores: 8 })]?.level).toBe(
      'medium',
    );
  });
});

describe('QualityGovernor', () => {
  it('stays put at a comfortable frame rate', () => {
    const governor = new QualityGovernor(4);
    expect(run(governor, 45, 30)).toBe(0);
    expect(governor.rung).toBe(4);
  });

  it('steps down after two slow seconds and keeps stepping while slow', () => {
    const governor = new QualityGovernor(4);
    run(governor, 20, 2.1);
    expect(governor.rung).toBe(3);
    run(governor, 20, 6.1);
    expect(governor.rung).toBe(0);
    expect(run(governor, 20, 10)).toBe(0);
  });

  it('climbs after five fast seconds, but not back onto a rung it just left', () => {
    const governor = new QualityGovernor(4);
    run(governor, 20, 2.1);
    expect(governor.rung).toBe(3);
    run(governor, 60, 30);
    expect(governor.rung).toBe(3);
    // The minute is up about 30 s later; from then on it climbs a rung every five seconds.
    run(governor, 60, 60);
    expect(governor.rung).toBe(LADDER.length - 1);
  });

  it('ignores hitches such as a background tab', () => {
    const governor = new QualityGovernor(4);
    for (let i = 0; i < 20; i++) governor.sample(2);
    expect(governor.rung).toBe(4);
  });
});
