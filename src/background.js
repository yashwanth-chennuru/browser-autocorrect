import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

class GrammarPipeline {
  static task = 'text2text-generation';
  static model = 'Xenova/grammar-synthesis-small';
  static instance = null;

  static async getInstance() {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, { dtype: 'q8' });
    }
    return this.instance;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'correct') {
    (async () => {
      try {
        const corrector = await GrammarPipeline.getInstance();
        const prompt = `grammar: ${request.text}`;
        const result = await corrector(prompt, {
          max_new_tokens: 128,
          temperature: 0.1,
          do_sample: false
        });

        let cleanText = result[0].generated_text;
        if (cleanText.toLowerCase().startsWith('grammar:')) {
          cleanText = cleanText.substring(8).trim();
        }

        sendResponse({ success: true, text: cleanText });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});
