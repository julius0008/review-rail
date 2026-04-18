import { getAppConfig } from "@repo/shared";

export type LlmCompletionResult = {
  output: string;
  model: string;
};

export async function generateOllamaReview(input: {
  prompt: string;
}): Promise<LlmCompletionResult> {
  const config = getAppConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  try {
    const response = await fetch(`${config.llm.ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.llm.ollama.model,
        prompt: input.prompt,
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      response?: string;
      model?: string;
    };

    if (!payload.response) {
      throw new Error("Ollama response was missing generated content");
    }

    return {
      output: payload.response,
      model: payload.model ?? config.llm.ollama.model,
    };
  } finally {
    clearTimeout(timeout);
  }
}
