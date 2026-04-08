import type LocalTrack from './LocalTrack';
declare const RecorderBase: {
    new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
    prototype: MediaRecorder;
    isTypeSupported(type: string): boolean;
};
export declare class LocalTrackRecorder<T extends LocalTrack> extends RecorderBase {
    byteStream: ReadableStream<Uint8Array>;
    constructor(track: T, options?: MediaRecorderOptions);
}
export declare function isRecordingSupported(): boolean;
export {};
//# sourceMappingURL=record.d.ts.map
