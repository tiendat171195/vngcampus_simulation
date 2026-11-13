import {
  ANIM,
  type AnimId,
  type AvatarConfig,
  CLOTH_COLOURS,
  MOVEMENT,
  PLAYER_STATUS,
} from '@campus/shared';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  type Sprite,
  Vector3,
} from 'three';
import { Avatar } from '../avatars/Avatar';
import { QUALITY_PRESETS, type QualityLevel } from '../core/quality';
import { useSession } from '../core/session';
import { createLabelSprite } from '../world/labels';
import { MeshBatch } from '../world/MeshBatch';
import { BubbleView } from './bubbles';
import type { Sample } from './Interpolator';
import { net } from './net';

/** Remote players drawn as full avatars, nearest first; the rest become impostors. */
const DETAIL_CAP: Record<QualityLevel, number> = { low: 24, medium: 48, high: 96 };
const TAG_CAP = 12;
const TAG_DISTANCE = 24;
const MAX_IMPOSTORS = 256;
const HEAD_HEIGHT = 2.05;

interface View {
  avatar: Avatar | null;
  /** The look the avatar was last dressed in. */
  look: AvatarConfig | null;
  tag: Sprite | null;
  tagText: string;
  bubble: BubbleView;
  sample: Sample;
  x: number;
  z: number;
  speed: number;
  animAccumulator: number;
  distance: number;
  visible: boolean;
}

/** A two-box figure, one instanced draw call for every distant player. */
function createImpostors(): InstancedMesh {
  const batch = new MeshBatch();
  batch.box([0, 0.55, 0], [0.42, 1.1, 0.26], '#ffffff');
  batch.box([0, 1.4, 0], [0.42, 0.42, 0.42], '#ffffff');
  const mesh = new InstancedMesh(
    batch.toGeometry({ colours: false }),
    new MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
    MAX_IMPOSTORS,
  );
  mesh.name = 'remote-impostors';
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

function disposeView(view: View): void {
  view.avatar?.dispose();
  view.bubble.clear();
  if (view.tag) {
    view.tag.removeFromParent();
    view.tag.material.map?.dispose();
    view.tag.material.dispose();
  }
}

/** Other people in the channel, drawn where they were 200 ms ago (docs/05-multiplayer.md §5). */
export function RemotePlayers() {
  const group = useMemo(() => new Group(), []);
  const impostors = useMemo(createImpostors, []);
  const views = useMemo(() => new Map<string, View>(), []);
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      rotation: new Quaternion(),
      up: new Vector3(0, 1, 0),
      position: new Vector3(),
      scale: new Vector3(1, 1, 1),
      colour: new Color(),
      order: [] as string[],
    }),
    [],
  );

  useEffect(() => {
    group.add(impostors);
    return () => {
      for (const view of views.values()) disposeView(view);
      views.clear();
      impostors.geometry.dispose();
      (impostors.material as MeshLambertMaterial).dispose();
    };
  }, [group, impostors, views]);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const level = useSession.getState().quality.level;
    const preset = QUALITY_PRESETS[level];
    const renderTime = net.renderTime(performance.now());

    for (const [id, view] of views) {
      if (!net.remotes.has(id)) {
        disposeView(view);
        views.delete(id);
      }
    }

    const order = scratch.order;
    order.length = 0;
    for (const [id, remote] of net.remotes) {
      let view = views.get(id);
      if (!view) {
        view = {
          avatar: null,
          look: null,
          tag: null,
          tagText: '',
          bubble: new BubbleView(),
          sample: { x: 0, y: 0, z: 0, yaw: 0 },
          x: 0,
          z: 0,
          speed: 0,
          animAccumulator: 0,
          distance: 0,
          visible: false,
        };
        views.set(id, view);
      }
      view.visible = remote.motion.sample(renderTime, view.sample);
      if (!view.visible) continue;
      // Speed from how far the interpolated position moved, smoothed: it paces the stride.
      const moved = Math.hypot(view.sample.x - view.x, view.sample.z - view.z) / Math.max(dt, 1e-3);
      view.speed += (Math.min(moved, MOVEMENT.runSpeed * 1.2) - view.speed) * Math.min(1, dt * 8);
      view.x = view.sample.x;
      view.z = view.sample.z;
      scratch.position.set(view.sample.x, view.sample.y, view.sample.z);
      view.distance = camera.position.distanceTo(scratch.position);
      if (view.distance <= preset.viewDistance) order.push(id);
      else {
        view.visible = false;
        if (view.avatar) view.avatar.object.visible = false;
        if (view.tag) view.tag.visible = false;
        view.bubble.clear();
      }
    }
    order.sort((a, b) => (views.get(a)?.distance ?? 0) - (views.get(b)?.distance ?? 0));

    let impostorCount = 0;
    order.forEach((id, rank) => {
      const view = views.get(id) as View;
      const remote = net.remotes.get(id);
      if (!remote) return;
      const { sample } = view;
      const detailed = rank < DETAIL_CAP[level];

      if (detailed) {
        if (!view.avatar) {
          view.avatar = new Avatar(remote.look);
          view.look = remote.look;
          group.add(view.avatar.object);
        }
        const avatar = view.avatar;
        // `look` is replaced, not mutated, when the person changes their avatar.
        if (view.look !== remote.look) {
          view.look = remote.look;
          avatar.setAvatar(remote.look);
        }
        avatar.object.visible = true;
        avatar.object.position.set(sample.x, sample.y, sample.z);
        avatar.object.rotation.y = sample.yaw;
        const interval =
          view.distance < preset.fullAnimationDistance
            ? 0
            : view.distance < preset.reducedAnimationDistance
              ? 1 / 15
              : 1 / 5;
        view.animAccumulator += dt;
        if (view.animAccumulator >= interval) {
          const away = remote.status === PLAYER_STATUS.reconnecting;
          const anim = (away ? ANIM.idle : remote.anim) as AnimId;
          avatar.update(view.animAccumulator, {
            anim,
            speed: anim === ANIM.walk || anim === ANIM.run ? view.speed : 0,
            emote: remote.emote,
            emoteSeq: remote.emoteSeq,
          });
          view.animAccumulator = 0;
        }
      } else {
        if (view.avatar) view.avatar.object.visible = false;
        if (impostorCount < MAX_IMPOSTORS) {
          scratch.rotation.setFromAxisAngle(scratch.up, sample.yaw);
          scratch.position.set(sample.x, sample.y, sample.z);
          scratch.matrix.compose(scratch.position, scratch.rotation, scratch.scale);
          impostors.setMatrixAt(impostorCount, scratch.matrix);
          impostors.setColorAt(
            impostorCount,
            scratch.colour.set(CLOTH_COLOURS[remote.look.topColour] ?? '#888888'),
          );
          impostorCount++;
        }
      }

      // Name tags for the nearest few.
      const tagged = rank < TAG_CAP && view.distance < TAG_DISTANCE;
      const label = remote.tag ? `${remote.name} (${remote.tag})` : remote.name;
      const text =
        remote.status === PLAYER_STATUS.reconnecting
          ? `${label} · mất kết nối`
          : remote.status === PLAYER_STATUS.afk
            ? `${label} · vắng mặt`
            : label;
      if (tagged && (!view.tag || view.tagText !== text)) {
        if (view.tag) {
          view.tag.removeFromParent();
          view.tag.material.map?.dispose();
          view.tag.material.dispose();
        }
        view.tag = createLabelSprite(text, 0.3);
        view.tag.name = 'name-tag';
        view.tagText = text;
        group.add(view.tag);
      }
      if (view.tag) {
        view.tag.visible = tagged;
        view.tag.position.set(sample.x, sample.y + HEAD_HEIGHT, sample.z);
      }

      // Speech bubbles follow the speaker while they are close enough to read.
      const bubble = net.bubbles.get(id);
      const saying =
        bubble && bubble.until > performance.now() && view.distance < TAG_DISTANCE
          ? bubble.text
          : null;
      view.bubble.update(group, saying, sample.x, sample.y, sample.z);
    });

    impostors.count = impostorCount;
    impostors.instanceMatrix.needsUpdate = true;
    if (impostors.instanceColor) impostors.instanceColor.needsUpdate = true;
  });

  return <primitive object={group} />;
}
