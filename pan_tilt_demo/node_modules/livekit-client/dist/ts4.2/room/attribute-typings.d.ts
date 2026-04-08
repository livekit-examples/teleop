export interface AgentAttributes {
    'lk.agent.inputs'?: AgentInput[];
    'lk.agent.outputs'?: AgentOutput[];
    'lk.agent.state'?: AgentState;
    'lk.publish_on_behalf'?: string;
    [property: string]: any;
}
export type AgentInput = 'audio' | 'video' | 'text';
export type AgentOutput = 'transcription' | 'audio';
export type AgentState = 'idle' | 'initializing' | 'listening' | 'thinking' | 'speaking';
/**
 * Schema for transcription-related attributes
 */
export interface TranscriptionAttributes {
    /**
     * The segment id of the transcription
     */
    'lk.segment_id'?: string;
    /**
     * The associated track id of the transcription
     */
    'lk.transcribed_track_id'?: string;
    /**
     * Whether the transcription is final
     */
    'lk.transcription_final'?: boolean;
    [property: string]: any;
}
export declare class Convert {
    static toAgentAttributes(json: string): AgentAttributes;
    static agentAttributesToJson(value: AgentAttributes): string;
    static toTranscriptionAttributes(json: string): TranscriptionAttributes;
    static transcriptionAttributesToJson(value: TranscriptionAttributes): string;
}
//# sourceMappingURL=attribute-typings.d.ts.map
