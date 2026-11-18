/** Colours of the greybox campus. One place, so the look can be tuned without touching geometry. */
export const PALETTE = {
  skyTop: '#5fa8e6',
  skyHorizon: '#dbeeff',
  sunlight: '#fff3dc',
  skylight: '#dcefff',
  groundBounce: '#d9d0be',

  outside: '#a9c48f',
  grass: '#b9d99b',
  park: '#a5d08a',
  paved: '#e6dfcf',
  road: '#8d949c',
  walkway: '#ecdfc4',
  water: '#4fbbe6',
  river: '#6aa9cc',
  curb: '#f3f0e8',
  fence: '#7b8a82',

  wall: '#f5f2ea',
  wallAccent: '#f28c28',
  /** VNG orange, as in the official artwork (vng.com.vn): the entrance canopy and signs. */
  brandOrange: '#ed5a26',
  canopy: '#eceef0',
  interiorWall: '#e9e4d9',
  glass: '#a9d6ea',
  slab: '#e6e1d6',
  slabEdge: '#f1ede4',
  roof: '#dfe3e7',
  floor: '#f4eddd',
  room: '#f6e2ba',
  landmark: '#ffd39b',
  kiosk: '#e7c9a2',

  stairs: '#d3cbbb',
  rail: '#73808c',
  /** Top rail of the glass balustrades around the atrium and along stairs (photos). */
  handrail: '#3a3f45',
  /** Exposed ceiling: the slabs are left dark with the services showing (photos). */
  ceiling: '#5d636b',

  // Interiors, from press and VNG photos (docs/03-world-and-assets.md §1.3).
  /** The wooden bleachers and herringbone floor of the atrium. */
  timber: '#c98a4b',
  timberDark: '#a86a36',
  /** Herringbone wood cladding: the LED wall, counter fronts, the coffee shop. */
  herringbone: '#c27536',
  timberFloor: '#d9a86e',
  rubberFloor: '#4f545c',
  screen: '#1b2330',
  screenLight: '#e9eef5',
  counterTop: '#e8e4dc',
  steel: '#c3c9cf',
  darkSteel: '#2a2d32',
  menuBoard: '#2f3440',
  canteenTable: '#c8935a',
  /** Canteen chairs are teal-green (photos). */
  canteenChair: '#2f7d6d',
  slats: '#d4a061',
  bulb: '#ffe7a3',
  mirror: '#d3e6ee',
  booth: '#b5a58c',
  brick: '#a4553d',
  white: '#f2f2ef',
  gate: '#f4f4f2',
  gateLight: '#39c56c',

  trunk: '#8a6a4a',
  leafA: '#5faa5c',
  leafB: '#7cc06a',
  lamp: '#4a5560',
  lampHead: '#fff3c4',
  planter: '#c9b48f',
  /** Open-plan desks are white with black mesh chairs (photos). */
  desk: '#f1f1ee',
  chair: '#2f3238',
  monitor: '#2b3038',
  shelf: '#c9a26b',
  carBody: '#ffffff',
  carGlass: '#2f3a45',
  carTyre: '#22262b',
  bench: '#b8875a',
  sofa: '#c8452f',
  lounger: '#f2efe6',
} as const;

/** Tints applied per parked car. */
export const CAR_COLOURS = [
  '#e5484d',
  '#3b82c4',
  '#f2f2f2',
  '#2f3338',
  '#f5a623',
  '#8fa3ad',
  '#3fa66b',
] as const;

/** Bean bags on the atrium bleachers: magenta, royal blue, off-white, yellow, black, pink. */
export const BEANBAG_COLOURS = [
  '#b8174f',
  '#2343a8',
  '#ece9e1',
  '#f0c419',
  '#2b2e33',
  '#e2589b',
] as const;

/** The house-shaped booths come in red, white, grey and black (photos). */
export const BOOTH_COLOURS = ['#b8322a', '#ececea', '#9aa0a6', '#33363c'] as const;

/** Yoga mats. */
export const MAT_COLOURS = ['#7a5ea8', '#3f9c8f', '#d9704a', '#4f7fc2'] as const;
