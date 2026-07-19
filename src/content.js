const DEBOUNCE_MS = 800;
const stateMap = new WeakMap();
const mirrorOwners = new Map();
const trackedElements = new Set();
let activeElement = null;
let activeTooltipPayload = null;

const tooltip = document.createElement("div");
tooltip.className = "grammar-ai-tooltip";
document.documentElement.appendChild(tooltip);

function isEditableTarget(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }
  return node.tagName === "TEXTAREA" || node.getAttribute("contenteditable") === "true";
}

function getEditableTarget(node) {
  if (!(node instanceof Element)) {
    return null;
  }
  return node.closest('textarea, [contenteditable="true"]');
}

function getElementText(element) {
  return element.tagName === "TEXTAREA" ? element.value : element.innerText;
}

function setElementText(element, text) {
  if (element.tagName === "TEXTAREA") {
    element.value = text;
  } else {
    element.innerText = text;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function splitWords(text) {
  return text.match(/\S+/g) ?? [];
}

function buildWordRanges(text) {
  const ranges = [];
  const regex = /\S+/g;
  let match = regex.exec(text);
  while (match) {
    ranges.push({ start: match.index, end: match.index + match[0].length, word: match[0] });
    match = regex.exec(text);
  }
  return ranges;
}

function getMismatches(originalText, correctedText) {
  const originalWords = splitWords(originalText);
  const correctedWords = splitWords(correctedText);
  const length = Math.min(originalWords.length, correctedWords.length);
  const mismatches = [];

  for (let index = 0; index < length; index += 1) {
    if (originalWords[index] !== correctedWords[index]) {
      mismatches.push({
        original: originalWords[index],
        suggestion: correctedWords[index],
        index
      });
    }
  }

  return mismatches;
}

function ensureState(element) {
  let state = stateMap.get(element);
  if (state) {
    return state;
  }

  const mirror = document.createElement("div");
  mirror.className = "grammar-ai-mirror";
  mirror.style.display = "none";

  const content = document.createElement("div");
  content.className = "grammar-ai-mirror-content";
  mirror.appendChild(content);

  document.documentElement.appendChild(mirror);

  state = {
    debounceId: null,
    mirror,
    content,
    text: "",
    wordRanges: [],
    mismatches: []
  };
  stateMap.set(element, state);
  mirrorOwners.set(mirror, element);
  trackedElements.add(element);
  return state;
}

function hideTooltip() {
  tooltip.style.display = "none";
  activeTooltipPayload = null;
}

function removeHighlights(element) {
  const state = stateMap.get(element);
  if (!state) {
    return;
  }

  state.mismatches = [];
  state.wordRanges = [];
  state.content.textContent = "";
  state.mirror.style.display = "none";
  element.classList.remove("grammar-ai-target");
  hideTooltip();
}

function syncMirrorPosition(element) {
  const state = stateMap.get(element);
  if (!state || state.mirror.style.display === "none") {
    return;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  state.mirror.style.left = `${rect.left}px`;
  state.mirror.style.top = `${rect.top}px`;
  state.mirror.style.width = `${rect.width}px`;
  state.mirror.style.height = `${rect.height}px`;
  state.mirror.style.font = style.font;
  state.mirror.style.letterSpacing = style.letterSpacing;
  state.mirror.style.lineHeight = style.lineHeight;
  state.mirror.style.padding = style.padding;
  state.mirror.style.borderRadius = style.borderRadius;
  state.mirror.style.textAlign = style.textAlign;
  state.mirror.style.direction = style.direction;
  state.mirror.scrollTop = element.scrollTop;
  state.mirror.scrollLeft = element.scrollLeft;
}

function renderHighlights(element) {
  const state = stateMap.get(element);
  if (!state || state.mismatches.length === 0) {
    removeHighlights(element);
    return;
  }

  const mismatchByWordIndex = new Map(state.mismatches.map((mismatch) => [mismatch.index, mismatch]));
  let html = "";
  let cursor = 0;

  state.wordRanges.forEach((range, wordIndex) => {
    if (cursor < range.start) {
      html += escapeHtml(state.text.slice(cursor, range.start));
    }
    const mismatch = mismatchByWordIndex.get(wordIndex);
    const wordText = state.text.slice(range.start, range.end);
    if (mismatch) {
      html += `<span class="grammar-error" data-word-index="${wordIndex}" data-suggestion="${escapeHtml(
        mismatch.suggestion
      )}">${escapeHtml(wordText)}</span>`;
    } else {
      html += escapeHtml(wordText);
    }
    cursor = range.end;
  });

  if (cursor < state.text.length) {
    html += escapeHtml(state.text.slice(cursor));
  }

  state.content.innerHTML = html;
  state.mirror.style.display = "block";
  element.classList.add("grammar-ai-target");
  syncMirrorPosition(element);
}

async function requestCorrection(element) {
  const state = ensureState(element);
  const text = getElementText(element);
  state.text = text;
  state.wordRanges = buildWordRanges(text);

  if (!text.trim()) {
    removeHighlights(element);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: "correct",
      type: "FIX_GRAMMAR",
      text
    });
    const correctedText = response?.text;
    const ok = response?.ok === true || response?.success === true;

    if (!ok || typeof correctedText !== "string") {
      removeHighlights(element);
      return;
    }

    state.mismatches = getMismatches(text, correctedText);
    renderHighlights(element);
  } catch {
    removeHighlights(element);
  }
}

function debounceCorrection(element) {
  const state = ensureState(element);
  if (state.debounceId) {
    window.clearTimeout(state.debounceId);
  }
  state.debounceId = window.setTimeout(() => {
    requestCorrection(element);
  }, DEBOUNCE_MS);
}

function replaceWordAtIndex(element, wordIndex, suggestion) {
  const state = stateMap.get(element);
  if (!state || !Number.isInteger(wordIndex) || !suggestion) {
    return;
  }
  const range = state.wordRanges[wordIndex];
  if (!range) {
    return;
  }

  const originalText = getElementText(element);
  const nextText = `${originalText.slice(0, range.start)}${suggestion}${originalText.slice(range.end)}`;
  setElementText(element, nextText);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  hideTooltip();
}

document.addEventListener("focusin", (event) => {
  const target = getEditableTarget(event.target);
  if (!target || !isEditableTarget(target)) {
    activeElement = null;
    hideTooltip();
    return;
  }
  activeElement = target;
  ensureState(target);
  syncMirrorPosition(target);
});

document.addEventListener("input", (event) => {
  const target = getEditableTarget(event.target);
  if (!target || !isEditableTarget(target)) {
    return;
  }
  activeElement = target;
  debounceCorrection(target);
});

document.addEventListener(
  "scroll",
  () => {
    trackedElements.forEach((element) => syncMirrorPosition(element));
    hideTooltip();
  },
  true
);

window.addEventListener("resize", () => {
  trackedElements.forEach((element) => syncMirrorPosition(element));
  hideTooltip();
});

document.addEventListener("mousemove", (event) => {
  const hoveredError = event.target instanceof Element ? event.target.closest(".grammar-error") : null;
  if (!hoveredError || !(hoveredError instanceof HTMLElement)) {
    hideTooltip();
    return;
  }

  const mirror = hoveredError.closest(".grammar-ai-mirror");
  if (!mirror) {
    hideTooltip();
    return;
  }

  const ownerElement = mirrorOwners.get(mirror);
  if (!ownerElement) {
    hideTooltip();
    return;
  }

  const wordIndex = Number.parseInt(hoveredError.dataset.wordIndex ?? "", 10);
  const suggestion = hoveredError.dataset.suggestion ?? "";
  if (!Number.isInteger(wordIndex) || !suggestion) {
    hideTooltip();
    return;
  }

  activeTooltipPayload = { element: ownerElement, wordIndex, suggestion };
  tooltip.innerHTML = `Replace with: <strong>${escapeHtml(suggestion)}</strong>`;
  tooltip.style.display = "block";

  const rect = hoveredError.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const aboveTop = rect.top - tooltipRect.height - 8;
  const top = aboveTop > 8 ? aboveTop : rect.bottom + 8;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - tooltipRect.width - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
});

tooltip.addEventListener("click", () => {
  if (!activeTooltipPayload) {
    return;
  }
  replaceWordAtIndex(
    activeTooltipPayload.element,
    activeTooltipPayload.wordIndex,
    activeTooltipPayload.suggestion
  );
});
