/** Rectangular 1-bit image; truthy means a dark pixel. */
export class BitImage {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;

  constructor(width: number, height: number, bits?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.bits = bits ?? new Uint8Array(width * height);
  }

  get(x: number, y: number): boolean {
    return this.bits[y * this.width + x] !== 0;
  }

  set(x: number, y: number, value: boolean): void {
    this.bits[y * this.width + x] = value ? 1 : 0;
  }

  inverted(): BitImage {
    const bits = new Uint8Array(this.bits.length);
    for (let i = 0; i < bits.length; i++) bits[i] = this.bits[i] ? 0 : 1;
    return new BitImage(this.width, this.height, bits);
  }
}
