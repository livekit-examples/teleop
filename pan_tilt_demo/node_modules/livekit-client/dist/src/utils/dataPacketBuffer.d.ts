export interface DataPacketItem {
    data: Uint8Array;
    sequence: number;
}
export declare class DataPacketBuffer {
    private buffer;
    private _totalSize;
    push(item: DataPacketItem): void;
    pop(): DataPacketItem | undefined;
    getAll(): DataPacketItem[];
    popToSequence(sequence: number): void;
    alignBufferedAmount(bufferedAmount: number): void;
    get length(): number;
}
//# sourceMappingURL=dataPacketBuffer.d.ts.map