import { EMOTE_BY_ID } from '@campus/shared';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { input, releaseAll } from '../game/core/input';
import { useSession } from '../game/core/session';
import { remotePicker } from '../game/net/pick';

/** Stick travel, in pixels, that counts as "all the way". */
const STICK_RADIUS = 56;
/** Touches that start in this left-hand share of the screen steer; the rest turn the camera. */
const STICK_ZONE = 0.45;

const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Transparent layer over the 3D view that turns keyboard, mouse and touch into game input.
 * Touch: the left part of the screen is a joystick that appears under the thumb, the rest
 * turns the camera, two fingers there zoom. Mouse: drag to turn, wheel to zoom.
 */
export function InputLayer() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const pointers = useRef({
    stick: null as { id: number; x: number; y: number } | null,
    look: new Map<number, { x: number; y: number }>(),
    pinch: 0,
    /** A press that may turn out to be a tap (on a colleague, to open their card). */
    tap: null as { id: number; x: number; y: number; t: number } | null,
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit && !event.repeat) {
        const id = Number(digit[1]);
        if (EMOTE_BY_ID.has(id)) input.emote = id;
        return;
      }
      if (event.code === 'KeyE' && !event.repeat) {
        input.interact = true;
        return;
      }
      if (!GAME_KEYS.has(event.code)) return;
      event.preventDefault();
      if (event.code === 'Space' && !event.repeat) input.jump = true;
      input.keys.add(event.code);
    };
    const up = (event: KeyboardEvent) => input.keys.delete(event.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, []);

  const showStick = (x: number, y: number, dx: number, dy: number, visible: boolean) => {
    if (!base.current || !knob.current) return;
    base.current.style.opacity = visible ? '1' : '0';
    base.current.style.transform = `translate(${x - STICK_RADIUS}px, ${y - STICK_RADIUS}px)`;
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone (a very short tap); the drag then simply ends early.
    }
    const isTouch = event.pointerType === 'touch';
    if (isTouch && !p.stick && event.clientX < window.innerWidth * STICK_ZONE) {
      p.stick = { id: event.pointerId, x: event.clientX, y: event.clientY };
      input.stick.active = true;
      showStick(event.clientX, event.clientY, 0, 0, true);
      return;
    }
    p.look.set(event.pointerId, { x: event.clientX, y: event.clientY });
    p.pinch = 0;
    p.tap =
      p.look.size === 1
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() }
        : null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current;
    if (p.stick?.id === event.pointerId) {
      let dx = event.clientX - p.stick.x;
      let dy = event.clientY - p.stick.y;
      const length = Math.hypot(dx, dy);
      if (length > STICK_RADIUS) {
        dx *= STICK_RADIUS / length;
        dy *= STICK_RADIUS / length;
      }
      input.stick.x = dx / STICK_RADIUS;
      input.stick.y = -dy / STICK_RADIUS;
      showStick(p.stick.x, p.stick.y, dx, dy, true);
      return;
    }
    const last = p.look.get(event.pointerId);
    if (!last) return;
    const current = { x: event.clientX, y: event.clientY };
    if (p.tap?.id === event.pointerId && Math.hypot(current.x - p.tap.x, current.y - p.tap.y) > 8)
      p.tap = null;
    p.look.set(event.pointerId, current);
    if (p.look.size >= 2) {
      const [a, b] = [...p.look.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      // Fingers moving apart zoom in.
      if (p.pinch > 0) input.zoom -= (spread - p.pinch) * 4;
      p.pinch = spread;
      return;
    }
    input.lookX += current.x - last.x;
    input.lookY += current.y - last.y;
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = pointers.current;
    if (p.stick?.id === event.pointerId) {
      p.stick = null;
      input.stick.active = false;
      input.stick.x = 0;
      input.stick.y = 0;
      showStick(0, 0, 0, 0, false);
    }
    p.look.delete(event.pointerId);
    p.pinch = 0;
    const tap = p.tap;
    p.tap = null;
    if (
      tap?.id === event.pointerId &&
      event.type === 'pointerup' &&
      performance.now() - tap.t < 400
    ) {
      const rect = event.currentTarget.getBoundingClientRect();
      const remote = remotePicker.pick(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (remote)
        useSession
          .getState()
          .setProfileCard({ userId: remote.userId, name: remote.name, guest: remote.tag !== '' });
    }
  };

  return (
    <div
      className="input-layer"
      role="application"
      aria-label="Vùng điều khiển nhân vật: WASD để đi, Shift để chạy, Space để nhảy"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={(event) => {
        input.zoom += event.deltaY;
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="stick" ref={base} aria-hidden="true">
        <div className="stick-knob" ref={knob} />
      </div>
      <button
        type="button"
        className="jump-button"
        aria-label="Nhảy"
        onPointerDown={(event) => {
          event.stopPropagation();
          input.jump = true;
        }}
      >
        ⤒
      </button>
    </div>
  );
}
