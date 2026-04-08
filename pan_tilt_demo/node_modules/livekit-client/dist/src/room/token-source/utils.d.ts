import { type TokenSourceResponse } from '@livekit/protocol';
import type { TokenPayload, TokenSourceFetchOptions } from './types';
export declare function isResponseTokenValid(response: TokenSourceResponse): boolean;
/** Given a LiveKit generated participant token, decodes and returns the associated {@link TokenPayload} data. */
export declare function decodeTokenPayload(token: string): TokenPayload;
/** Given two TokenSourceFetchOptions values, check to see if they are deep equal. */
export declare function areTokenSourceFetchOptionsEqual(a: TokenSourceFetchOptions, b: TokenSourceFetchOptions): boolean;
//# sourceMappingURL=utils.d.ts.map