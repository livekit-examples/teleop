/**
 * Implementation of AbortSignal.any
 * Creates a signal that will be aborted when any of the given signals is aborted.
 * @link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any
 */
export declare function abortSignalAny(signals: Array<AbortSignal>): AbortSignal;
/**
 * Implementation of AbortSignal.timeout
 * Creates a signal that will be aborted after the specified timeout.
 * @link https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout
 */
export declare function abortSignalTimeout(ms: number): AbortSignal;
//# sourceMappingURL=abort-signal-polyfill.d.ts.map
