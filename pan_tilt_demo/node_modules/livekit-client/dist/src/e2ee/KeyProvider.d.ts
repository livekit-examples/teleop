import type TypedEventEmitter from 'typed-emitter';
import { type KeyProviderCallbacks } from './events';
import type { KeyInfo, KeyProviderOptions, RatchetResult } from './types';
declare const BaseKeyProvider_base: new () => TypedEventEmitter<KeyProviderCallbacks>;
/**
 * @experimental
 */
export declare class BaseKeyProvider extends BaseKeyProvider_base {
    private keyInfoMap;
    private readonly options;
    private latestManuallySetKeyIndex;
    constructor(options?: Partial<KeyProviderOptions>);
    /**
     * callback to invoke once a key has been set for a participant
     * @param key
     * @param participantIdentity
     * @param keyIndex
     */
    protected onSetEncryptionKey(key: CryptoKey, participantIdentity?: string, keyIndex?: number): void;
    /**
     * Callback being invoked after a key has been ratcheted.
     * Can happen when:
     * - A decryption failure occurs and the key is auto-ratcheted
     * - A ratchet request is sent (see {@link ratchetKey()})
     * @param ratchetResult Contains the ratcheted chain key (exportable to other participants) and the derived new key material.
     * @param participantId
     * @param keyIndex
     */
    protected onKeyRatcheted: (ratchetResult: RatchetResult, participantId?: string, keyIndex?: number) => void;
    getKeys(): KeyInfo[];
    getLatestManuallySetKeyIndex(): number;
    getOptions(): KeyProviderOptions;
    ratchetKey(participantIdentity?: string, keyIndex?: number): void;
}
/**
 * A basic KeyProvider implementation intended for a single shared
 * passphrase between all participants
 * @experimental
 */
export declare class ExternalE2EEKeyProvider extends BaseKeyProvider {
    ratchetInterval: number | undefined;
    constructor(options?: Partial<Omit<KeyProviderOptions, 'sharedKey'>>);
    /**
     * Accepts a passphrase that's used to create the crypto keys.
     * When passing in a string, PBKDF2 is used. (recommended for maximum compatibility across SDKs)
     * When passing in an ArrayBuffer of cryptographically random numbers, HKDF is used.
     *
     * Note: Not all client SDKS support HKDF.
     * @param key
     */
    setKey(key: string | ArrayBuffer): Promise<void>;
}
export {};
//# sourceMappingURL=KeyProvider.d.ts.map