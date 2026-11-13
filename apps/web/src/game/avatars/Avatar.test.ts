import {
  ANIM,
  AVATAR_FIELDS,
  avatarChoices,
  DEFAULT_AVATAR,
  formatAvatar,
  MOVEMENT,
} from '@campus/shared';
import { Box3, type SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatar, liveAvatarGeometries } from './Avatar';

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

  it('shares one geometry between avatars that look the same, and frees it with the last', () => {
    const before = liveAvatarGeometries();
    const a = new Avatar();
    const b = new Avatar({ ...DEFAULT_AVATAR });
    const c = new Avatar({ ...DEFAULT_AVATAR, topColour: 3 });
    expect(bodyOf(a).geometry).toBe(bodyOf(b).geometry);
    expect(bodyOf(c).geometry).not.toBe(bodyOf(a).geometry);
    expect(liveAvatarGeometries()).toBe(before + 2);
    a.dispose();
    // Disposing one avatar must not break the other.
    expect(bodyOf(b).geometry.getAttribute('position').count).toBeGreaterThan(0);
    b.dispose();
    c.dispose();
    expect(liveAvatarGeometries()).toBe(before);
  });

  it('stays within the avatar budget whatever is chosen (docs/03 §6)', () => {
    for (const field of AVATAR_FIELDS)
      for (let value = 0; value < avatarChoices(field); value++) {
        const avatar = new Avatar({ ...DEFAULT_AVATAR, [field]: value });
        const body = bodyOf(avatar);
        const label = `${field}=${value}`;
        expect(avatar.triangles, label).toBeLessThanOrEqual(5000);
        expect(body.skeleton.bones.length, label).toBeLessThanOrEqual(40);
        const box = new Box3().setFromBufferAttribute(
          body.geometry.getAttribute('position') as never,
        );
        expect(box.min.y, label).toBeCloseTo(0, 2);
        expect(box.max.y, label).toBeLessThan(MOVEMENT.capsuleHeight + 0.12);
        expect(Math.max(box.max.x, -box.min.x), label).toBeLessThan(0.4);
        avatar.dispose();
      }
  });

  it('changes clothes without losing the skeleton or the pose', () => {
    const avatar = new Avatar();
    for (let i = 0; i < 30; i++) avatar.update(1 / 60, { anim: ANIM.sit, speed: 0 });
    const skeleton = bodyOf(avatar).skeleton;
    const seated = boneY(avatar, 'hips');
    const plain = bodyOf(avatar).geometry.getAttribute('position').count;
    avatar.setAvatar({ ...DEFAULT_AVATAR, hair: 8, accessory: 3 });
    expect(bodyOf(avatar).geometry.getAttribute('position').count).toBeGreaterThan(plain);
    expect(bodyOf(avatar).skeleton).toBe(skeleton);
    expect(boneY(avatar, 'hips')).toBeCloseTo(seated, 5);
    expect(avatar.avatar).toBe(formatAvatar({ ...DEFAULT_AVATAR, hair: 8, accessory: 3 }));
    avatar.dispose();
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
