import { describe, expect, it } from 'vitest';
import { campusMap } from './campus';
import type { CampusMap } from './schema';
import { createFloorProjection, renderFloorSvg } from './svg';

describe('createFloorProjection', () => {
  it('converts metres to pixels and back', () => {
    const projection = createFloorProjection(campusMap, { width: 700 });
    expect(projection.scale).toBe(2);
    expect(projection.height).toBe(400);
    expect(projection.toSvg(campusMap.meta.bounds.min)).toEqual([0, 0]);
    expect(projection.toSvg([0, 0])).toEqual([400, 180]);
    const [x, z] = projection.fromSvg(projection.toSvg([-58.5, 17.25]));
    expect(x).toBeCloseTo(-58.5);
    expect(z).toBeCloseTo(17.25);
  });

  it('follows a custom view', () => {
    const projection = createFloorProjection(campusMap, {
      width: 500,
      view: { min: [-50, -50], max: [50, 0] },
    });
    expect(projection.scale).toBe(5);
    expect(projection.height).toBe(250);
    expect(projection.fromSvg([250, 125])).toEqual([0, -25]);
  });
});

describe('renderFloorSvg', () => {
  const ground = renderFloorSvg(campusMap, 'F1');

  it('produces a sized SVG document', () => {
    expect(ground.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 549"')).toBe(
      true,
    );
    expect(ground.endsWith('</svg>')).toBe(true);
  });

  it('tags areas, structures and doors so a picker can map clicks back', () => {
    expect(ground).toContain('data-area="area.atrium"');
    expect(ground).toContain('data-structure="structure.main"');
    expect(ground).toContain('data-door="door.main.north"');
  });

  it('labels landmarks and drops labels that would collide', () => {
    expect(ground).toContain('>Atrium</text>');
    expect(ground).toContain('>Hồ bơi</text>');
    expect(ground).not.toContain('>Khu hồ bơi</text>');
    expect(renderFloorSvg(campusMap, 'F1', { showLabels: false })).not.toContain('</text>');
  });

  it('draws POIs only when asked, optionally by kind', () => {
    expect(ground).not.toContain('data-poi=');
    const all = renderFloorSvg(campusMap, 'F1', { showPois: true });
    expect(all).toContain('data-poi="poi.spawn.gate_01"');
    expect(all).toContain('data-poi="poi.seat.koi_01"');
    const seats = renderFloorSvg(campusMap, 'F1', { showPois: ['seat'] });
    expect(seats).toContain('data-poi="poi.seat.koi_01"');
    expect(seats).not.toContain('data-poi="poi.spawn.gate_01"');
  });

  it('shows only what is on the requested floor', () => {
    const upper = renderFloorSvg(campusMap, 'F2', { showPois: true });
    expect(upper).toContain('data-area="area.office.f2.main"');
    expect(upper).not.toContain('data-area="area.atrium"');
    expect(upper).toContain('data-poi="poi.kiosk.office_f2"');
    expect(upper).not.toContain('data-poi="poi.kiosk.lobby"');
    expect(upper).toContain('Khoảng thông tầng');
  });

  it('escapes text', () => {
    const map = JSON.parse(JSON.stringify(campusMap)) as CampusMap;
    const atrium = map.areas.find((area) => area.id === 'area.atrium');
    if (atrium) atrium.name.vi = 'A & B <c>';
    expect(renderFloorSvg(map, 'F1')).toContain('A &amp; B &lt;c&gt;');
  });
});
