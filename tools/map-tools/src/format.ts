import type { CampusMap } from '@campus/map-data';

/**
 * Serialises a map with one record per line. Plain `JSON.stringify(map, null, 2)` would put every
 * coordinate on its own line and make the file several thousand lines of noise.
 */
export function formatCampusMap(map: CampusMap): string {
  const one = (value: unknown) => JSON.stringify(value);
  const rows = (items: readonly unknown[], indent: string) =>
    items.map((item) => `${indent}${one(item)}`).join(',\n');

  const sections = [
    `  "version": ${one(map.version)}`,
    `  "meta": ${one(map.meta)}`,
    ...(['floors', 'areas', 'structures', 'paths', 'connectors', 'pois'] as const).map(
      (key) => `  "${key}": [\n${rows(map[key], '    ')}\n  ]`,
    ),
    `  "spawnSets": {\n${Object.entries(map.spawnSets)
      .map(([name, ids]) => `    ${one(name)}: ${one(ids)}`)
      .join(',\n')}\n  }`,
    `  "props": [\n${map.props
      .map(
        (group) =>
          `    {"model": ${one(group.model)}, "instances": [\n${rows(group.instances, '      ')}\n    ]}`,
      )
      .join(',\n')}\n  ]`,
  ];

  return `{\n${sections.join(',\n')}\n}\n`;
}
