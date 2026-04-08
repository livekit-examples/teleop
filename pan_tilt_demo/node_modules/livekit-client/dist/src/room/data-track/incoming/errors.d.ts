import { LivekitReasonedError } from '../../errors';
export declare enum DataTrackSubscribeErrorReason {
    /** The track has been unpublished and is no longer available */
    Unpublished = 0,
    /** Request to subscribe to data track timed-out */
    Timeout = 1,
    /** Cannot subscribe to data track when disconnected */
    Disconnected = 2,
    /** Subscription to data track cancelled by caller */
    Cancelled = 4
}
export declare class DataTrackSubscribeError<Reason extends DataTrackSubscribeErrorReason = DataTrackSubscribeErrorReason> extends LivekitReasonedError<Reason> {
    readonly name = "DataTrackSubscribeError";
    reason: Reason;
    reasonName: string;
    constructor(message: string, reason: Reason, options?: {
        cause?: unknown;
    });
    static unpublished(): DataTrackSubscribeError<DataTrackSubscribeErrorReason.Unpublished>;
    static timeout(): DataTrackSubscribeError<DataTrackSubscribeErrorReason.Timeout>;
    static disconnected(): DataTrackSubscribeError<DataTrackSubscribeErrorReason.Disconnected>;
    static cancelled(): DataTrackSubscribeError<DataTrackSubscribeErrorReason.Cancelled>;
}
//# sourceMappingURL=errors.d.ts.map