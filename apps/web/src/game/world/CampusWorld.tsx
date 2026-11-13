import { campusIndex, campusMap } from '@campus/map-data/campus';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { useDebugStore } from '../debug/debugStore';
import { buildWorld, type World } from './buildWorld';
import { createAreaLabels, disposeLabels } from './labels';

const WorldContext = createContext<World | null>(null);

/** The built world, for anything that needs to collide with it or query it. */
export function useWorld(): World {
  const world = useContext(WorldContext);
  if (!world) throw new Error('useWorld must be used inside <CampusWorld>');
  return world;
}

/** Builds the campus once and keeps it in the scene; children can reach it with `useWorld()`. */
export function CampusWorld({ children }: { children?: ReactNode }) {
  const world = useMemo(() => buildWorld(campusMap), []);
  const cutaway = useDebugStore((state) => state.cutaway);
  const showCollider = useDebugStore((state) => state.showCollider);

  useEffect(() => {
    const labels = createAreaLabels(campusMap, campusIndex);
    for (const { level, sprite } of labels) world.levels.get(level)?.add(sprite);
    return () => disposeLabels(labels);
  }, [world]);

  useEffect(() => () => world.dispose(), [world]);

  useEffect(() => {
    world.showUpTo(cutaway);
  }, [world, cutaway]);

  useEffect(() => {
    world.collider.visible = showCollider;
  }, [world, showCollider]);

  return (
    <WorldContext.Provider value={world}>
      <primitive object={world.root} />
      <primitive object={world.collider} />
      {children}
    </WorldContext.Provider>
  );
}
