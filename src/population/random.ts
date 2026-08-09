/** Small reproducible PRNG. Never use Math.random in simulation code. */
export class SeededRandom {
  private state: number;
  public constructor(seed: number) { if (!Number.isInteger(seed)) throw new Error('Simulation seed must be an integer'); this.state = seed >>> 0; }
  public next(): number { this.state = (this.state + 0x6D2B79F5) | 0; let value = Math.imul(this.state ^ this.state >>> 15, 1 | this.state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4_294_967_296; }
  public integer(minimum: number, maximum: number): number { return Math.floor(this.next() * (maximum - minimum + 1)) + minimum; }
  public pick<T>(items: readonly T[]): T { if (items.length === 0) throw new Error('Cannot pick from an empty collection'); return items[Math.floor(this.next() * items.length)]; }
  public shuffle<T>(items: readonly T[]): T[] { const copy = [...items]; for (let index = copy.length - 1; index > 0; index -= 1) { const swap = this.integer(0, index); [copy[index], copy[swap]] = [copy[swap], copy[index]]; } return copy; }
}
