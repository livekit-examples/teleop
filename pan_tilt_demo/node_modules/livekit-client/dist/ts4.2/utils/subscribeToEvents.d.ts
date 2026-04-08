import type { EventMap } from 'typed-emitter';
import type TypedEventEmitter from 'typed-emitter';
/** A test helper to listen to events received by an event emitter and allow them to be imperatively
 * queried after the fact. */
export declare function subscribeToEvents<Callbacks extends EventMap, EventNames extends keyof Callbacks = keyof Callbacks>(eventEmitter: TypedEventEmitter<Callbacks>, eventNames: Array<EventNames>): {
    /** Listen for the next occurrance of an event to be emitted, or return the last event that was
     * buffered (but hasn't been processed yet). */
    waitFor<EventPayload extends Parameters<Callbacks[EventName]>[0], EventName extends EventNames = EventNames>(eventName: EventName): Promise<EventPayload>;
    /** Are there events of the given name which are waiting to be processed? Use this to assert
     * that no unexpected events have been emitted. */
    areThereBufferedEvents<EventPayload extends Parameters<Callbacks[EventName]>[0], EventName extends EventNames = EventNames>(eventName: EventName): boolean;
    /** Cleanup any lingering subscriptions. */
    unsubscribe: () => void;
};
//# sourceMappingURL=subscribeToEvents.d.ts.map
