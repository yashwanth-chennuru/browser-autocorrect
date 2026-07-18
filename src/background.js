import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

class GrammarPipelineSingleton {
  static instancePromise = null;

  static async getInstance() {
    if (!GrammarPipelineSingleton.instancePromise) {
      GrammarPipelineSingleton.instancePromise = pipeline(
        "text2text-generation",
        "Xenova/grammar-synthesis-small",
        {
          device: "webgpu",
          dtype: "q4"
        }
      );
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

      const grammar = await GrammarPipelineSingleton.getInstance();
      const output = await grammar(`grammar: [${message.text}]`);
      const corrected =
        Array.isArray(output) && output[0] && typeof output[0].generated_text === "string"
          ? output[0].generated_text
          : "";

      sendResponse({ ok: true, text: corrected });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown processing error.";
      sendResponse({ ok: false, error: errorMessage });
    }
  };

  handleMessage();
  return true;
});
