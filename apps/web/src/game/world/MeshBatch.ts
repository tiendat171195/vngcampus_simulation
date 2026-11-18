import type { Polygon, ReadonlyVec2, Vec2 } from '@campus/map-data';
import { signedArea } from '@campus/map-data';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Matrix4,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three';

export type Vec3 = readonly [x: number, y: number, z: number];

/**
 * Accumulates many simple shapes into one geometry, so a whole level of the campus is a single
 * draw call. Colour is stored per vertex; lighting comes from flat shading, so no normals are kept.
 *
 * Map coordinates `[x, z]` go straight to three.js `(x, y, z)` with Y up.
 */
export class MeshBatch {
  private readonly positions: number[] = [];
  private readonly colours: number[] = [];
  private readonly indices: number[] = [];
  private readonly scratch = new Color();

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  private vertex(point: Vec3, colour: Color): number {
    this.positions.push(point[0], point[1], point[2]);
    this.colours.push(colour.r, colour.g, colour.b);
    return this.positions.length / 3 - 1;
  }

  private colour(value: string | Color): Color {
    return typeof value === 'string' ? this.scratch.set(value) : value;
  }

  /** A quad whose corners run counter-clockwise when seen from its front. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: string | Color): void {
    const tint = this.colour(colour);
    const i = this.vertex(a, tint);
    this.vertex(b, tint);
    this.vertex(c, tint);
    this.vertex(d, tint);
    this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** A flat polygon at height `y`, optionally with holes. Faces up unless `faceDown` is set. */
  polygon(
    outline: Polygon,
    y: number,
    colour: string | Color,
    holes: readonly Polygon[] = [],
    faceDown = false,
  ): void {
    const tint = this.colour(colour);
    const rings = [outline, ...holes];
    const flat = rings.flat();
    const base = this.positions.length / 3;
    for (const [x, z] of flat) this.vertex([x, y, z], tint);

    const toVectors = (ring: Polygon) => ring.map(([x, z]) => new Vector2(x, z));
    const triangles = ShapeUtils.triangulateShape(toVectors(outline), holes.map(toVectors));
    for (const [i, j, k] of triangles as [number, number, number][]) {
      const [a, b, c] = [flat[i], flat[j], flat[k]] as [ReadonlyVec2, ReadonlyVec2, ReadonlyVec2];
      // Seen from above, a triangle faces up when it runs a → +Z → +X, i.e. negative area here.
      const facesUp = signedArea([a, b, c]) < 0;
      if (facesUp !== faceDown) this.indices.push(base + i, base + j, base + k);
      else this.indices.push(base + i, base + k, base + j);
    }
  }

  /**
   * A prism over a four-sided base. Each corner has its own bottom and top height, which is what
   * makes ramps and sloped rails possible. The base may be given in either winding.
   */
  prism(
    base: readonly [ReadonlyVec2, ReadonlyVec2, ReadonlyVec2, ReadonlyVec2],
    bottom: readonly number[],
    top: readonly number[],
    colour: string | Color,
  ): void {
    // Normalise to counter-clockwise as seen from above.
    const order = signedArea(base) < 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const low = order.map(
      (i) =>
        [(base[i] as ReadonlyVec2)[0], bottom[i] as number, (base[i] as ReadonlyVec2)[1]] as Vec3,
    );
    const high = order.map(
      (i) => [(base[i] as ReadonlyVec2)[0], top[i] as number, (base[i] as ReadonlyVec2)[1]] as Vec3,
    );
    const [l0, l1, l2, l3] = low as [Vec3, Vec3, Vec3, Vec3];
    const [h0, h1, h2, h3] = high as [Vec3, Vec3, Vec3, Vec3];
    this.quad(h0, h1, h2, h3, colour);
    this.quad(l3, l2, l1, l0, colour);
    this.quad(l0, l1, h1, h0, colour);
    this.quad(l1, l2, h2, h1, colour);
    this.quad(l2, l3, h3, h2, colour);
    this.quad(l3, l0, h0, h3, colour);
  }

  /** An upright wall along the segment a → b, `thickness` wide, from height y0 to y1. */
  wall(
    a: ReadonlyVec2,
    b: ReadonlyVec2,
    thickness: number,
    y0: number,
    y1: number,
    colour: string | Color,
  ): void {
    this.slopedWall(a, b, thickness, [y0, y1], [y0, y1], colour);
  }

  /** Like {@link wall}, with separate bottom/top heights at each end. */
  slopedWall(
    a: ReadonlyVec2,
    b: ReadonlyVec2,
    thickness: number,
    atA: readonly [number, number],
    atB: readonly [number, number],
    colour: string | Color,
  ): void {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-6) return;
    const nx = (-(b[1] - a[1]) / length) * (thickness / 2);
    const nz = ((b[0] - a[0]) / length) * (thickness / 2);
    this.prism(
      [
        [a[0] + nx, a[1] + nz],
        [a[0] - nx, a[1] - nz],
        [b[0] - nx, b[1] - nz],
        [b[0] + nx, b[1] + nz],
      ],
      [atA[0], atA[0], atB[0], atB[0]],
      [atA[1], atA[1], atB[1], atB[1]],
      colour,
    );
  }

  /** An axis-aligned box rotated by `yaw` radians about its vertical axis. */
  box(centre: Vec3, size: Vec3, colour: string | Color, yaw = 0): void {
    const [hx, hz] = [size[0] / 2, size[2] / 2];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const corner = (x: number, z: number): Vec2 => [
      centre[0] + x * cos + z * sin,
      centre[2] - x * sin + z * cos,
    ];
    const y0 = centre[1] - size[1] / 2;
    const y1 = centre[1] + size[1] / 2;
    this.prism(
      [corner(-hx, -hz), corner(-hx, hz), corner(hx, hz), corner(hx, -hz)],
      [y0, y0, y0, y0],
      [y1, y1, y1, y1],
      colour,
    );
  }

  /** A solid slab: `outline` minus `holes`, with its top at `yTop`. */
  slab(
    outline: Polygon,
    holes: readonly Polygon[],
    yTop: number,
    thickness: number,
    colour: string | Color,
    sideColour: string | Color = colour,
    undersideColour: string | Color = sideColour,
  ): void {
    this.polygon(outline, yTop, colour, holes);
    this.polygon(outline, yTop - thickness, undersideColour, holes, true);
    const side = typeof sideColour === 'string' ? new Color(sideColour) : sideColour;
    const rim = (ring: Polygon, outward: boolean) => {
      // With negative signed area the ring runs counter-clockwise from above, and walking it
      // keeps the inside on the left; flip so each quad faces away from the solid.
      const forward = signedArea(ring) < 0 === outward;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[forward ? i : (i + 1) % ring.length] as ReadonlyVec2;
        const q = ring[forward ? (i + 1) % ring.length : i] as ReadonlyVec2;
        this.quad(
          [p[0], yTop - thickness, p[1]],
          [q[0], yTop - thickness, q[1]],
          [q[0], yTop, q[1]],
          [p[0], yTop, p[1]],
          side,
        );
      }
    };
    rim(outline, true);
    for (const hole of holes) rim(hole, false);
  }

  /** A strip of constant width along a polyline, lying flat at height `y`, with rounded joints. */
  ribbon(
    points: readonly ReadonlyVec2[],
    width: number,
    y: number,
    colour: string | Color,
    closed = false,
  ): void {
    const tint = typeof colour === 'string' ? new Color(colour) : colour;
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i] as ReadonlyVec2;
      const b = points[(i + 1) % points.length] as ReadonlyVec2;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) continue;
      const nx = (-(b[1] - a[1]) / length) * (width / 2);
      const nz = ((b[0] - a[0]) / length) * (width / 2);
      this.polygon(
        [
          [a[0] + nx, a[1] + nz],
          [a[0] - nx, a[1] - nz],
          [b[0] - nx, b[1] - nz],
          [b[0] + nx, b[1] + nz],
        ],
        y,
        tint,
      );
    }
    for (const point of points) this.disc(point, width / 2, y, tint);
  }

  disc(
    centre: ReadonlyVec2,
    radius: number,
    y: number,
    colour: string | Color,
    segments = 12,
  ): void {
    const ring: Vec2[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      ring.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
    }
    this.polygon(ring, y, colour);
  }

  /** Adds any three.js geometry, transformed, in a single colour. */
  merge(geometry: BufferGeometry, matrix: Matrix4, colour: string | Color): void {
    const tint = this.colour(colour);
    const source = geometry.getAttribute('position');
    const base = this.positions.length / 3;
    const point = new Vector3();
    for (let i = 0; i < source.count; i++) {
      point.fromBufferAttribute(source, i).applyMatrix4(matrix);
      this.vertex([point.x, point.y, point.z], tint);
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    else for (let i = 0; i < source.count; i++) this.indices.push(base + i);
  }

  /** Copies everything in another batch into this one, transformed, keeping its colours. */
  append(source: MeshBatch, matrix: Matrix4): void {
    const base = this.positions.length / 3;
    const point = new Vector3();
    for (let i = 0; i < source.positions.length; i += 3) {
      point
        .set(
          source.positions[i] as number,
          source.positions[i + 1] as number,
          source.positions[i + 2] as number,
        )
        .applyMatrix4(matrix);
      this.positions.push(point.x, point.y, point.z);
      this.colours.push(
        source.colours[i] as number,
        source.colours[i + 1] as number,
        source.colours[i + 2] as number,
      );
    }
    for (const index of source.indices) this.indices.push(base + index);
  }

  toGeometry(options: { colours?: boolean } = {}): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    if (options.colours ?? true) {
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colours), 3));
    }
    const vertexCount = this.positions.length / 3;
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new BufferAttribute(new IndexArray(this.indices), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}
