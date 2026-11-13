import { type CampusMap, type MapIndex, pointInPolygon, polygonCentroid } from '@campus/map-data';
import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';
import type { LevelId } from './context';

export interface AreaLabel {
  level: LevelId;
  sprite: Sprite;
}

const FONT = '600 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * A name board drawn with the 2D canvas, so Vietnamese diacritics come out right with whatever
 * font the device has. Browser only.
 */
export function createLabelSprite(text: string, worldHeight: number): Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not available');
  context.font = FONT;
  const paddingX = 30;
  const width = Math.ceil(context.measureText(text).width) + paddingX * 2;
  const height = 80;
  canvas.width = width;
  canvas.height = height;

  context.font = FONT;
  context.fillStyle = 'rgba(255, 253, 246, 0.92)';
  context.beginPath();
  context.roundRect(2, 2, width - 4, height - 4, 22);
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(43, 38, 32, 0.25)';
  context.stroke();
  context.fillStyle = '#2b2620';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, height / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const sprite = new Sprite(
    new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }),
  );
  sprite.scale.set((worldHeight * width) / height, worldHeight, 1);
  sprite.renderOrder = 2;
  return sprite;
}

/** Floating name boards over the landmark areas of the map. */
export function createAreaLabels(map: CampusMap, index: MapIndex): AreaLabel[] {
  return map.areas
    .filter((area) => area.tags.includes('landmark'))
    .map((area) => {
      const [x, z] = polygonCentroid(area.polygon);
      const floorY = index.floors.get(area.floor)?.y ?? 0;
      const indoor = map.structures.some(
        (s) => s.floors.includes(area.floor) && pointInPolygon([x, z], s.footprint),
      );
      const sprite = createLabelSprite(area.name.vi, indoor ? 1.1 : 2.2);
      sprite.position.set(x, floorY + (indoor ? 3.5 : area.kind === 'water' ? 3 : 6), z);
      sprite.name = `label:${area.id}`;
      return { level: area.floor, sprite };
    });
}

export function disposeLabels(labels: readonly AreaLabel[]): void {
  for (const { sprite } of labels) {
    sprite.removeFromParent();
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
}
