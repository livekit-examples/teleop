export declare const U16_MAX_SIZE = 65535;
export declare const U32_MAX_SIZE = 4294967295;
/**
 * A number of fields withing the data tracks packet specification assume wrap around behavior when
 * an unsigned type is incremented beyond its max size (ie, the packet `sequence` field). This
 * wrapper type manually reimplements this wrap around behavior given javascript's lack of fixed
 * size integer types.
 */
export declare class WrapAroundUnsignedInt<MaxSize extends number> {
    value: number;
    private maxSize;
    static u16(raw: number): WrapAroundUnsignedInt<65535>;
    static u32(raw: number): WrapAroundUnsignedInt<4294967295>;
    constructor(raw: number, maxSize: MaxSize);
    /** Manually clamp the given containing value according to the wrap around max size bounds. Use
     * this after out of bounds modification to the contained value by external code. */
    clamp(): void;
    clone(): WrapAroundUnsignedInt<MaxSize>;
    /** When called, maps the containing value to a new containing value. After mapping, the wrap
     * around external max size bounds are applied. Note that this is a mutative operation. */
    update(updateFn: (value: number) => number): void;
    /** Increments the given `n` to the inner value. Note that this is a mutative operation. */
    increment(n?: number): void;
    /** Decrements the given `n` from the inner value. Note that this is a mutative operation. */
    decrement(n?: number): void;
    getThenIncrement(): WrapAroundUnsignedInt<MaxSize>;
    /** Returns true if {@link this} is before the passed other {@link WrapAroundUnsignedInt}. */
    isBefore(other: WrapAroundUnsignedInt<MaxSize>): boolean;
}
export declare class DataTrackTimestamp<RateInHz extends number> {
    rateInHz: RateInHz;
    timestamp: WrapAroundUnsignedInt<typeof U32_MAX_SIZE>;
    static fromRtpTicks(rtpTicks: number): DataTrackTimestamp<90000>;
    /** Generates a timestamp initialized to a non cryptographically secure random value, so that
     * different streams are more difficult to correlate in packet capture. */
    static rtpRandom(): DataTrackTimestamp<90000>;
    private constructor();
    asTicks(): number;
    clone(): DataTrackTimestamp<RateInHz>;
    wrappingAdd(n: number): void;
    /** Returns true if {@link this} is before the passed other {@link DataTrackTimestamp}. */
    isBefore(other: DataTrackTimestamp<RateInHz>): boolean;
}
export declare class DataTrackClock<RateInHz extends number> {
    epoch: Date;
    base: DataTrackTimestamp<RateInHz>;
    previous: DataTrackTimestamp<RateInHz>;
    rateInHz: RateInHz;
    private constructor();
    static startingNow<RateInHz extends number>(base: DataTrackTimestamp<RateInHz>, rateInHz: RateInHz): DataTrackClock<RateInHz>;
    static startingAtTime<RateInHz extends number>(epoch: Date, base: DataTrackTimestamp<RateInHz>, rateInHz: RateInHz): DataTrackClock<RateInHz>;
    static rtpStartingNow(base: DataTrackTimestamp<90000>): DataTrackClock<90000>;
    static rtpStartingAtTime(epoch: Date, base: DataTrackTimestamp<90000>): DataTrackClock<90000>;
    now(): DataTrackTimestamp<RateInHz>;
    at(timestamp: Date): DataTrackTimestamp<RateInHz>;
    /** Convert a duration since the epoch into clock ticks. */
    static durationInMsToTicks(durationMilliseconds: number, rateInHz: number): number;
}
export declare function coerceToDataView<Input extends DataView | ArrayBuffer | Uint8Array>(input: Input): DataView;
//# sourceMappingURL=utils.d.ts.map