export interface LlmChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}
export interface LlmChatOptions {
    model: string;
    messages: LlmChatMessage[];
}
/**
 * Streaming fetch to OpenAI-compatible or Ollama LLM endpoint.
 * Returns the full accumulated response text.
 */
export declare function streamLlmChat(host: string, body: {
    model: string;
    messages: {
        role: string;
        content: string;
    }[];
}): Promise<string>;
/**
 * Streaming LLM chat with optional per-chunk callback.
 * Supports both Ollama (:11434) and OpenAI-compatible APIs.
 */
export declare function streamLlmChatChunked(host: string, body: {
    model: string;
    messages: {
        role: string;
        content: string;
    }[];
}, onChunk?: (text: string) => void): Promise<string>;
//# sourceMappingURL=llmChat.d.ts.map