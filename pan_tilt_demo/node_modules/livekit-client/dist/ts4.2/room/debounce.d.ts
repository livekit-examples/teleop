export type Options<Result> = {
    isImmediate?: boolean;
    maxWait?: number;
    callback?: (data: Result) => void;
};
export interface DebouncedFunction<Args extends any[], F extends (...args: Args) => any> {
    (this: ThisParameterType<F>, ...args: Args & Parameters<F>): Promise<ReturnType<F>>;
    cancel: (reason?: any) => void;
}
export declare function debounce<Args extends any[], F extends (...args: Args) => any>(func: F, waitMilliseconds?: number, options?: Options<ReturnType<F>>): DebouncedFunction<Args, F>;
//# sourceMappingURL=debounce.d.ts.map
