export declare class TTLMap<K, V> {
    private _map;
    private ttl;
    private _lastCleanup;
    /**
     * @param ttl ttl of the key (ms)
     */
    constructor(ttl: number);
    set(key: K, value: V): this;
    get(key: K): V | undefined;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
    cleanup(): void;
    get size(): number;
    forEach(callback: (value: V, key: K, map: Map<K, V>) => void): void;
    map<U>(callback: (value: V, key: K, map: Map<K, V>) => U): U[];
    private asValueMap;
}
//# sourceMappingURL=ttlmap.d.ts.map