import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Fog, type PerspectiveCamera } from 'three';
import { useDebugStore } from '../debug/debugStore';
import { PALETTE } from '../world/palette';
import {
  FIXED_DPR,
  initialRung,
  LADDER,
  QUALITY_PRESETS,
  QualityGovernor,
  type Rung,
} from './quality';
import { useSession } from './session';
import { useSettings } from './settings';

function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    return String(gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

/**
 * Applies the quality setting to the renderer: pixel ratio, fog and far plane. On "auto" it
 * watches the frame rate and moves along the quality ladder (docs/04-client.md §4).
 */
export function QualityController() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const setDpr = useThree((state) => state.setDpr);
  const setting = useSettings((state) => state.quality);
  const freeCamera = useDebugStore((state) => state.cameraMode === 'free');
  const setQuality = useSession((state) => state.setQuality);

  const governor = useMemo(
    () =>
      new QualityGovernor(
        initialRung({
          renderer: rendererName(gl.getContext()),
          touch: window.matchMedia('(pointer: coarse)').matches,
          cores: navigator.hardwareConcurrency ?? 4,
        }),
      ),
    [gl],
  );
  const rung = useRef<Rung>(governor.current);

  const apply = useMemo(
    () => (next: Rung) => {
      rung.current = next;
      const dpr = Math.min(next.dpr, window.devicePixelRatio || 1);
      setDpr(dpr);
      const preset = QUALITY_PRESETS[next.level];
      // The free debug camera flies far out; do not fog the campus away from it.
      const distance = freeCamera ? 900 : preset.viewDistance;
      scene.fog = new Fog(PALETTE.skyHorizon, distance * 0.45, distance);
      camera.far = distance * 1.15;
      camera.updateProjectionMatrix();
      setQuality(next.level, dpr);
    },
    [setDpr, scene, camera, freeCamera, setQuality],
  );

  useEffect(() => {
    apply(setting === 'auto' ? governor.current : { level: setting, dpr: FIXED_DPR[setting] });
  }, [apply, setting, governor]);

  useFrame((_, delta) => {
    if (setting !== 'auto') return;
    if (governor.sample(delta)) apply(LADDER[governor.rung] as Rung);
  });

  return null;
}

/** Marks the world as ready once it has actually been drawn twice. */
export function WorldReadySignal() {
  const frames = useRef(0);
  const markWorldReady = useSession((state) => state.markWorldReady);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 2) markWorldReady();
  });
  return null;
}
