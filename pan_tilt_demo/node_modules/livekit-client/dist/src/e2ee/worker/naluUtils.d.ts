/**
 * NALU (Network Abstraction Layer Unit) utilities for H.264 and H.265 video processing
 * Contains functions for parsing and working with NALUs in video frames
 */
/**
 * Detected codec type from NALU analysis
 */
export type DetectedCodec = 'h264' | 'h265' | 'unknown';
/**
 * Result of NALU processing for frame encryption
 */
export interface NALUProcessingResult {
    /** Number of unencrypted bytes at the start of the frame */
    unencryptedBytes: number;
    /** Detected codec type */
    detectedCodec: DetectedCodec;
    /** Whether this frame requires NALU processing */
    requiresNALUProcessing: boolean;
}
/**
 * Process NALU data for frame encryption, detecting codec and finding unencrypted bytes
 * @param data Frame data
 * @param knownCodec Known codec from other sources (optional)
 * @returns NALU processing result
 */
export declare function processNALUsForEncryption(data: Uint8Array, knownCodec?: 'h264' | 'h265'): NALUProcessingResult;
//# sourceMappingURL=naluUtils.d.ts.map