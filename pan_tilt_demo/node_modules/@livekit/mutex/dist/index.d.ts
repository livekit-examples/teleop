export declare class Mutex {
    private _locking;
    private _locks;
    constructor();
    isLocked(): boolean;
    lock(): Promise<() => void>;
}
export declare class MultiMutex {
    private _queue;
    private _limit;
    private _locks;
    constructor(limit: number);
    isLocked(): boolean;
    lock(): Promise<() => void>;
    private _unlock;
}
//# sourceMappingURL=index.d.ts.map