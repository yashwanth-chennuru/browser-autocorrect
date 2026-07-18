import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

class GrammarPipelineSingleton {
  static instancePromise = null;
  static backend = "webgpu";

  static async createWebGPUPipeline() {
    return pipeline("text2text-generation", "Xenova/grammar-synthesis-small", {
      device: "webgpu",
      dtype: "fp32"
    });
  }

  static async createWasmPipeline() {
    return pipeline("text2text-generation", "Xenova/grammar-synthesis-small", {
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

      const grammar = await GrammarPipelineSingleton.getInstance();
      const output = await grammar(`grammar: ${message.text}`, {
        do_sample: false
      });
      const generatedText =
        Array.isArray(output) && output[0] && typeof output[0].generated_text === "string"
          ? output[0].generated_text
          : "";
      const corrected = generatedText.replace(/^grammar:\s*/i, "").trim();

      sendResponse({ ok: true, text: corrected, backend: GrammarPipelineSingleton.getBackend() });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown processing error.";
      sendResponse({ ok: false, error: errorMessage });
    }
  };

  handleMessage();
  return true;
});
