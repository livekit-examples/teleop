type InferErrors<T> = T extends TypedPromise<any, infer E> ? E : never;
export default class TypedPromise<T, E extends Error> extends Promise<T> {
    constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason: E) => void) => void);
    catch<TResult = never>(onrejected?: ((reason: E) => TResult | PromiseLike<TResult>) | null | undefined): TypedPromise<T | TResult, E>;
    static resolve: {
        (): TypedPromise<void, never>;
        <V>(value: V): TypedPromise<Awaited<V>, never>;
    };
    static reject<E extends Error>(reason: E): TypedPromise<never, E>;
    static all<T extends readonly unknown[] | []>(values: T): TypedPromise<{
        -readonly [P in keyof T]: Awaited<T[P]>;
    }, InferErrors<T[number]>>;
    static race<T extends readonly (TypedPromise<any, any> | any)[]>(values: T): TypedPromise<T[number] extends TypedPromise<infer U, any> ? U : T[number] extends PromiseLike<infer U> ? U : Awaited<T[number]>, InferErrors<T[number]>>;
}
export {};
//# sourceMappingURL=TypedPromise.d.ts.map