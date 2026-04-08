import type { DecodeRatchetOptions, KeySet } from '../types';
import type { ParticipantKeyHandler } from './ParticipantKeyHandler';
export declare class DataCryptor {
    private static sendCount;
    private static makeIV;
    static encrypt(data: Uint8Array, keys: ParticipantKeyHandler): Promise<{
        payload: Uint8Array;
        iv: Uint8Array;
        keyIndex: number;
    }>;
    static decrypt(data: Uint8Array, iv: Uint8Array, keys: ParticipantKeyHandler, keyIndex?: number, initialMaterial?: KeySet, ratchetOpts?: DecodeRatchetOptions): Promise<{
        payload: Uint8Array;
    }>;
}
//# sourceMappingURL=DataCryptor.d.ts.map