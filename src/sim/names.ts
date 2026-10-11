// Deterministic names from animal ids.
import { mix32 } from './rng';

const A = ['Bra', 'Fen', 'Hol', 'Tam', 'Wil', 'Ash', 'Bri', 'Cal', 'Dun', 'Eld', 'Fin', 'Gor', 'Har', 'Isk', 'Jun', 'Kel', 'Lor', 'Mab', 'Nim', 'Orr', 'Pip', 'Quin', 'Ros', 'Sal', 'Tor', 'Ulf', 'Ves', 'Wren', 'Yar', 'Zel', 'Bel', 'Cor'];
const B = ['ble', 'dor', 'en', 'ick', 'wyn', 'mor', 'eth', 'a', 'o', 'ie', 'ley', 'by', 'rin', 'nok', 'sel', 'tha', 'well', 'ash', 'den', 'ny'];

export function animalName(id: number): string {
  const h = mix32(id * 2654435761);
  return A[h % A.length] + B[(h >>> 8) % B.length];
}
