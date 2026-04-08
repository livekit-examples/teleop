import type { RegionSettings } from '@livekit/protocol';
export declare const DEFAULT_MAX_AGE_MS = 5000;
export declare const STOP_REFETCH_DELAY_MS = 30000;
type CachedRegionSettings = {
    regionSettings: RegionSettings;
    updatedAtInMs: number;
    maxAgeInMs: number;
};
export declare class RegionUrlProvider {
    private static readonly cache;
    private static settingsTimeouts;
    private static connectionTrackers;
    private static fetchLock;
    private static fetchRegionSettings;
    private static scheduleRefetch;
    private static updateCachedRegionSettings;
    private static stopRefetch;
    private static scheduleCleanup;
    private static cancelCleanup;
    notifyConnected(): void;
    notifyDisconnected(): void;
    private serverUrl;
    private token;
    private attemptedRegions;
    constructor(url: string, token: string);
    updateToken(token: string): void;
    isCloud(): boolean;
    getServerUrl(): URL;
    /** @internal */
    fetchRegionSettings(abortSignal?: AbortSignal): Promise<CachedRegionSettings>;
    getNextBestRegionUrl(abortSignal?: AbortSignal): Promise<string | null>;
    resetAttempts(): void;
    setServerReportedRegions(settings: CachedRegionSettings): void;
}
export {};
//# sourceMappingURL=RegionUrlProvider.d.ts.map