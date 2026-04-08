import { LivekitReasonedError } from '../../errors';
import type { DataTrackHandleError } from '../handle';
export declare enum DataTrackDeserializeErrorReason {
    TooShort = 0,
    HeaderOverrun = 1,
    MissingExtWords = 2,
    UnsupportedVersion = 3,
    InvalidHandle = 4,
    MalformedExt = 5
}
export declare class DataTrackDeserializeError<Reason extends DataTrackDeserializeErrorReason = DataTrackDeserializeErrorReason> extends LivekitReasonedError<DataTrackDeserializeErrorReason> {
    readonly name = "DataTrackDeserializeError";
    reason: Reason;
    reasonName: string;
    cause?: Reason extends DataTrackDeserializeErrorReason.InvalidHandle ? DataTrackHandleError : never;
    constructor(message: string, reason: Reason, options?: {
        cause?: unknown;
    });
    static tooShort(): DataTrackDeserializeError<DataTrackDeserializeErrorReason.TooShort>;
    static headerOverrun(): DataTrackDeserializeError<DataTrackDeserializeErrorReason.HeaderOverrun>;
    static missingExtWords(): DataTrackDeserializeError<DataTrackDeserializeErrorReason.MissingExtWords>;
    static unsupportedVersion(version: number): DataTrackDeserializeError<DataTrackDeserializeErrorReason.UnsupportedVersion>;
    static invalidHandle(cause: DataTrackHandleError): DataTrackDeserializeError<DataTrackDeserializeErrorReason.InvalidHandle>;
    static malformedExt(tag: number): DataTrackDeserializeError<DataTrackDeserializeErrorReason.MalformedExt>;
}
export declare enum DataTrackSerializeErrorReason {
    TooSmallForHeader = 0,
    TooSmallForPayload = 1
}
export declare class DataTrackSerializeError<Reason extends DataTrackSerializeErrorReason = DataTrackSerializeErrorReason> extends LivekitReasonedError<DataTrackSerializeErrorReason> {
    readonly name = "DataTrackSerializeError";
    reason: Reason;
    reasonName: string;
    constructor(message: string, reason: Reason, options?: {
        cause?: unknown;
    });
    static tooSmallForHeader(): DataTrackSerializeError<DataTrackSerializeErrorReason.TooSmallForHeader>;
    static tooSmallForPayload(): DataTrackSerializeError<DataTrackSerializeErrorReason.TooSmallForPayload>;
}
//# sourceMappingURL=errors.d.ts.map