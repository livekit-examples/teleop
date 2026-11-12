/** Normalized Ackermann keyboard steering, reset for each armed input session. */
export class KeyboardSteering {
  private value = 0;

  reset() {
    this.value = 0;
  }

  sample(direction: number, elapsedMs: number): number {
    if (!Number.isFinite(direction) || Math.abs(direction) > 1 || !Number.isFinite(elapsedMs))
      throw new Error('Invalid keyboard steering sample.');
    // Never turn a stalled browser timer into a jump to full lock.
    const seconds = Math.max(0, Math.min(50, elapsedMs)) / 1000;
    // A direction change returns through center before building opposite lock.
    const target = direction === 0 || this.value * direction < 0 ? 0 : direction;
    const rate = target === 0 ? 3.2 : 0.8;
    const difference = target - this.value;
    this.value += Math.sign(difference) * Math.min(Math.abs(difference), rate * seconds);
    return this.value;
  }
}
