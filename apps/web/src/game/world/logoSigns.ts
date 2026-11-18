import type { CampusMap, FloorId } from '@campus/map-data';
import {
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import logoUrl from '../../assets/brand/vng-logo-orange.png';
import type { LevelId } from './context';

/** Width over height of the official artwork (886 × 356 px). */
const LOGO_ASPECT = 886 / 356;
/** Centre of a sign above its floor: high on the facade band, as in the photos. */
const SIGN_LIFT = 2.6;

export interface LogoSign {
  level: LevelId;
  mesh: Mesh;
}

/**
 * The VNG signs on the facades (map props `logo_sign`): the official artwork as a texture,
 * unmodified, `s` metres wide, facing the prop's yaw.
 */
export function createLogoSigns(map: CampusMap): { signs: LogoSign[]; dispose(): void } {
  const instances = map.props.find((group) => group.model === 'logo_sign')?.instances ?? [];
  if (instances.length === 0) return { signs: [], dispose() {} };
  const texture: Texture = new TextureLoader().load(logoUrl);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.5,
    side: DoubleSide,
    roughness: 0.6,
  });
  const geometries: PlaneGeometry[] = [];
  const floorY = (floor: FloorId) => map.floors.find((f) => f.id === floor)?.y ?? 0;
  const signs = instances.map((instance) => {
    const width = instance.s ?? 8;
    const geometry = new PlaneGeometry(width, width / LOGO_ASPECT);
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'logo_sign';
    mesh.position.set(instance.p[0], floorY(instance.floor) + SIGN_LIFT, instance.p[1]);
    // A plane faces +Z; yaw is measured from +Z towards +X.
    mesh.rotation.y = ((instance.yawDeg ?? 0) * Math.PI) / 180;
    return { level: instance.floor, mesh };
  });
  return {
    signs,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
