/**
 * BackOffStrategy implements exponential backoff for connection failures.
 *
 * When severe connection failures occur (e.g., network issues, server unavailability),
 * this strategy introduces increasing delays between reconnection attempts to avoid
 * overwhelming the server and to give transient issues time to resolve.
 *
 * This strategy is only applied to LiveKit Cloud projects. It identifies
 * projects by extracting the project name from the connection URL and tracks failures
 * per project. Self-hosted deployments (URLs without a project identifier) are not
 * subject to backoff delays.
 *
 * The class is implemented as a singleton to maintain consistent backoff state across
 * the entire application lifecycle instead of room instance lifecycle.
 */
export declare class BackOffStrategy {
    private static _instance;
    private failedConnectionAttempts;
    private backOffPromises;
    private constructor();
    static getInstance(): BackOffStrategy;
    addFailedConnectionAttempt(urlString: string): void;
    getBackOffPromise(urlString: string): Promise<void>;
    resetFailedConnectionAttempts(urlString: string): void;
    resetAll(): void;
}
//# sourceMappingURL=BackOffStrategy.d.ts.map