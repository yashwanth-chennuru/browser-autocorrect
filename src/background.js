import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_ID = "Xenova/grammar-synthesis-small";
const BACKEND = "wasm";

class GrammarPipelineSingleton {
  static instancePromise = null;

  static async createPipeline() {
    return pipeline("text2text-generation", MODEL_ID, {
      dtype: "q8"
    });
  }

  static async getInstance() {
    if (!GrammarPipelineSingleton.instancePromise) {
      GrammarPipelineSingleton.instancePromise = GrammarPipelineSingleton.createPipeline();
    }

    return GrammarPipelineSingleton.instancePromise;
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
      const sourceCharCount = sourceText.length;

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
      const correctedWordCount = corrected.split(/\s+/).filter(Boolean).length;
      const isShortInputExplosion =
        wordCount <= 2 &&
        correctedWordCount >= 5 &&
        corrected.length > Math.max(sourceCharCount * 2, sourceCharCount + 12);
      const finalText = corrected && !isShortInputExplosion ? corrected : sourceText;

      sendResponse({ ok: true, text: finalText, backend: BACKEND });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown processing error.";
      sendResponse({ ok: false, error: errorMessage });
    }
  };

  handleMessage();
  return true;
});
