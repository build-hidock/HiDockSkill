/**
 * Streaming fetch to OpenAI-compatible or Ollama LLM endpoint.
 * Returns the full accumulated response text.
 */
export async function streamLlmChat(host, body) {
    return streamLlmChatChunked(host, body);
}
/**
 * Streaming LLM chat with optional per-chunk callback.
 * Supports both Ollama (:11434) and OpenAI-compatible APIs.
 */
export async function streamLlmChatChunked(host, body, onChunk) {
    const isOllama = host.includes("11434");
    const url = isOllama ? `${host}/api/chat` : `${host}/v1/chat/completions`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...body,
            stream: true,
            temperature: 0.5,
            top_p: 0.8,
            ...(isOllama
                ? { options: { num_predict: 4096, temperature: 0.5, top_p: 0.8 } }
                : { max_tokens: 4096 }),
        }),
    });
    if (!response.ok) {
        throw new Error(`LLM server returned ${response.status}: ${await response.text()}`);
    }
    let content = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split("\n")) {
            const trimmed = line.replace(/^data: /, "").trim();
            if (!trimmed || trimmed === "[DONE]")
                continue;
            try {
                const obj = JSON.parse(trimmed);
                // Ollama format: { message: { content } }
                const ollamaContent = obj.message?.content;
                if (ollamaContent) {
                    content += ollamaContent;
                    if (onChunk)
                        onChunk(ollamaContent);
                    continue;
                }
                // OpenAI format: { choices: [{ delta: { content } }] }
                const choices = obj.choices;
                const chunk = choices?.[0]?.delta?.content;
                if (chunk) {
                    content += chunk;
                    if (onChunk)
                        onChunk(chunk);
                }
            }
            catch {
                // partial JSON line, ignore
            }
        }
    }
    return content;
}
//# sourceMappingURL=llmChat.js.map