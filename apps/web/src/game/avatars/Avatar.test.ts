import { ANIM, MOVEMENT } from '@campus/shared';
import { Box3, type SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

const bodyOf = (avatar: Avatar) =>
  avatar.object.children.find((c) => c.name === 'avatar') as SkinnedMesh;

/** World-space height of a bone after the pose has been applied. */
const boneY = (avatar: Avatar, name: string) => {
  avatar.object.updateMatrixWorld(true);
  const bone = bodyOf(avatar).skeleton.bones.find((b) => b.name === name);
  return bone ? new Vector3().setFromMatrixPosition(bone.matrixWorld).y : Number.NaN;
};

describe('Avatar', () => {
  it('is one skinned mesh about as tall as the collision capsule', () => {
    const avatar = new Avatar();
    const body = bodyOf(avatar);
    expect(body.isSkinnedMesh).toBe(true);
    const box = new Box3().setFromBufferAttribute(body.geometry.getAttribute('position') as never);
    expect(box.max.y).toBeGreaterThan(MOVEMENT.capsuleHeight - 0.15);
    expect(box.max.y).toBeLessThan(MOVEMENT.capsuleHeight + 0.1);
    expect(box.min.y).toBeCloseTo(0, 2);
    avatar.dispose();
  });

  it('shares geometry buffers between avatars but not colours', () => {
    const a = new Avatar();
    const b = new Avatar({
      skin: '#000000',
      hair: '#000000',
      top: '#ff0000',
      bottom: '#000000',
      shoes: '#000000',
    });
    const ga = bodyOf(a).geometry;
    const gb = bodyOf(b).geometry;
    expect(ga.getAttribute('position')).toBe(gb.getAttribute('position'));
    expect(ga.getAttribute('color')).not.toBe(gb.getAttribute('color'));
    a.dispose();
    // Disposing one avatar must not break the other.
    expect(gb.getAttribute('position').count).toBeGreaterThan(0);
    b.dispose();
  });

  it('lowers the hips when sitting and swings the legs when walking', () => {
    const avatar = new Avatar();
    for (let i = 0; i < 60; i++) avatar.update(1 / 60, { anim: ANIM.idle, speed: 0 });
    const standing = boneY(avatar, 'hips');
    for (let i = 0; i < 60; i++) avatar.update(1 / 60, { anim: ANIM.sit, speed: 0 });
    expect(boneY(avatar, 'hips')).toBeLessThan(standing - 0.1);

    const walker = new Avatar();
    const left: number[] = [];
    for (let i = 0; i < 90; i++) {
      walker.update(1 / 60, { anim: ANIM.walk, speed: MOVEMENT.walkSpeed });
      left.push(bodyOf(walker).skeleton.bones.find((b) => b.name === 'legL')?.rotation.x ?? 0);
    }
    expect(Math.max(...left) - Math.min(...left)).toBeGreaterThan(0.6);
    avatar.dispose();
    walker.dispose();
  });
});
