import type { VideoCodec } from '../..';
export declare const VP8KeyFrame8x8: Uint8Array;
export declare const H264KeyFrame2x2SPS: Uint8Array;
export declare const H264KeyFrame2x2PPS: Uint8Array;
export declare const H264KeyFrame2x2IDR: Uint8Array;
export declare const H264KeyFrame2x2: Uint8Array[];
export declare const OpusSilenceFrame: Uint8Array;
/**
 * Pre-computed SHA-256 hashes for secure comparison operations
 */
export declare const CryptoHashes: {
    readonly VP8KeyFrame8x8: "ef0161653d8b2b23aad46624b420af1d03ce48950e9fc85718028f91b50f9219";
    readonly H264KeyFrame2x2SPS: "f0a0e09647d891d6d50aa898bce7108090375d0d55e50a2bb21147afee558e44";
    readonly H264KeyFrame2x2PPS: "61d9665eed71b6d424ae9539330a3bdd5cb386d4d781c808219a6e36750493a7";
    readonly H264KeyFrame2x2IDR: "faffc26b68a2fc09096fa20f3351e706398b6f838a7500c8063472c2e476e90d";
    readonly OpusSilenceFrame: "aad8d31fc56b2802ca500e58c2fb9d0b29ad71bb7cb52cd6530251eade188988";
};
/**
 * Check if a byte array matches any of the known SIF payload frame types using secure crypto hashes
 */
export declare function identifySifPayload(data: Uint8Array | ArrayBuffer): Promise<VideoCodec | 'opus' | null>;
//# sourceMappingURL=sifPayload.d.ts.map
