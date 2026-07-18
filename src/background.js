import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_ID = "Xenova/grammar-synthesis-small";

function isDegenerateOutput(text) {
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9']/g, ""))
    .filter(Boolean);

  if (tokens.length < 6) {
    return false;
  }

  const uniqueRatio = new Set(tokens).size / tokens.length;
  return uniqueRatio < 0.35;
}

class GrammarPipelineSingleton {
  static instancePromise = null;
  static backend = "webgpu";

  static async createWebGPUPipeline() {
    return pipeline("text2text-generation", MODEL_ID, {
      device: "webgpu",
      dtype: "fp32"
    });
  }

  static async createWasmPipeline() {
    return pipeline("text2text-generation", MODEL_ID, {
      dtype: "q8"
    });
  }

  static async getInstance() {
    if (!GrammarPipelineSingleton.instancePromise) {
      GrammarPipelineSingleton.instancePromise = (async () => {
        try {
          GrammarPipelineSingleton.backend = "webgpu";
          return await GrammarPipelineSingleton.createWebGPUPipeline();
        } catch (webgpuError) {
          console.warn("WebGPU pipeline init failed. Falling back to WASM.", webgpuError);
          GrammarPipelineSingleton.backend = "wasm";
          return GrammarPipelineSingleton.createWasmPipeline();
        }
      })();
    }

    return GrammarPipelineSingleton.instancePromise;
  }

  static getBackend() {
    return GrammarPipelineSingleton.backend;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handleMessage = async () => {
    try {
      if (!message || message.type !== "FIX_GRAMMAR" || typeof message.text !== "string") {
        throw new Error("Invalid request payload.");
      }
      const sourceText = message.text.trim();
      const wordCount = sourceText.split(/\s+/).filter(Boolean).length;

      if (wordCount <= 1) {
        sendResponse({
          ok: true,
          text: sourceText,
          backend: "rule",
          notice: "Use a full sentence for better grammar correction."
        });
        return;
      }

      const grammar = await GrammarPipelineSingleton.getInstance();
      const output = await grammar(`grammar: ${sourceText}`, {
        do_sample: false,
        max_new_tokens: Math.max(32, Math.min(128, wordCount * 5)),
        no_repeat_ngram_size: 3
      });
      const generatedText =
        Array.isArray(output) && output[0] && typeof output[0].generated_text === "string"
          ? output[0].generated_text
          : "";
      const corrected = generatedText.replace(/^grammar:\s*/i, "").trim();
      const finalText = corrected && !isDegenerateOutput(corrected) ? corrected : sourceText;

      sendResponse({ ok: true, text: finalText, backend: GrammarPipelineSingleton.getBackend() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown processing error.";
      sendResponse({ ok: false, error: errorMessage });
    }
  };

  handleMessage();
  return true;
});
