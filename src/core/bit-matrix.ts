/**
 * Square matrix of modules. `get(x, y)` addresses column x, row y; truthy
 * means a dark module.
 */
export class BitMatrix {
  readonly size: number;
  private readonly bits: Uint8Array;

  constructor(size: number, bits?: Uint8Array) {
    if (bits !== undefined && bits.length !== size * size) {
      throw new Error(`bit buffer length ${bits.length} does not match size ${size}`);
    }
    this.size = size;
    this.bits = bits ?? new Uint8Array(size * size);
  }

  get(x: number, y: number): boolean {
    return this.bits[y * this.size + x] !== 0;
  }

  set(x: number, y: number, value: boolean): void {
    this.bits[y * this.size + x] = value ? 1 : 0;
  }

  /** Marks a width×height region starting at (left, top). */
  setRegion(left: number, top: number, width: number, height: number): void {
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        this.bits[y * this.size + x] = 1;
      }
    }
  }

  clone(): BitMatrix {
    return new BitMatrix(this.size, this.bits.slice());
  }
}
