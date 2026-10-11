// Chart colours per species (distinct hues; prey warm and green, hunters red/blue/violet).
export const SPECIES_COLORS = [
  '#d9a441', // rabbit
  '#9a9fa8', // mouse
  '#c96a2b', // squirrel
  '#8b5e3c', // deer
  '#7c8f3a', // beaver
  '#58b368', // frog
  '#3fa7d6', // fish
  '#ef6c23', // fox
  '#6d7b8a', // cat
  '#c0392b', // hawk
  '#9b6fd1', // owl
  '#a3a73a', // snake
  '#5d8fc9', // heron
  '#485a73', // wolf
  '#6b3f2a', // bear
  '#3b3433', // vulture
];

export function hueColor(h: number, s = 70, l = 52): string {
  return `hsl(${h} ${s}% ${l}%)`;
}
