const inputText = document.getElementById("input-text");
const outputText = document.getElementById("output-text");
const status = document.getElementById("status");
const fixButton = document.getElementById("fix-btn");

fixButton.addEventListener("click", async () => {
  const text = inputText.value.trim();
  outputText.value = "";

  if (!text) {
    status.textContent = "Please enter text to correct.";
    return;
  }

  status.textContent = "Processing on local GPU...";
  fixButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "FIX_GRAMMAR",
      text
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Failed to process grammar correction.");
    }

    outputText.value = response.text;
    status.textContent = "";
  } catch (error) {
    status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    fixButton.disabled = false;
  }
});
