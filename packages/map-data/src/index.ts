// The library: types, geometry, queries and rendering for any map.
// The campus itself is a separate entry point, `@campus/map-data/campus`, so that tools which
// only need the library (such as the generator that writes the campus) do not load the data.
export * from './frame';
export * from './geometry';
export * from './query';
export * from './schema';
export * from './svg';
