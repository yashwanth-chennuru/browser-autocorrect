const DEBOUNCE_DELAY = 800;
const stateByElement = new WeakMap();
const mirrorOwners = new WeakMap();
const trackedElements = new Set();
let activeEditable = null;
let activeSuggestion = null;

const tooltip = document.createElement('div');
tooltip.id = 'local-grammar-tooltip';
document.body.appendChild(tooltip);

function isEditableElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  return element.matches('textarea, [contenteditable="true"]');
}

function findEditableTarget(node) {
  if (!(node instanceof Element)) {
    return null;
  }
  return node.closest('textarea, [contenteditable="true"]');
}

function getTextFromElement(element) {
  return element.tagName === 'TEXTAREA' ? element.value : element.innerText;
}

function setTextToElement(element, text) {
  if (element.tagName === 'TEXTAREA') {
    element.value = text;
  } else {
    element.innerText = text;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitWords(text) {
  return text.match(/\S+/g) ?? [];
}

function buildWordRanges(text) {
  const ranges = [];
  const regex = /\S+/g;
  let match = regex.exec(text);

  while (match) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      word: match[0]
    });
    match = regex.exec(text);
  }

  return ranges;
}

function computeWordDiffs(originalText, correctedText) {
  const originalWords = splitWords(originalText);
  const correctedWords = splitWords(correctedText);
  const compareLength = Math.min(originalWords.length, correctedWords.length);
  const mismatches = [];

  for (let index = 0; index < compareLength; index += 1) {
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
  let state = stateByElement.get(element);
  if (state) {
    return state;
  }

  const mirror = document.createElement('div');
  mirror.className = 'local-grammar-mirror';
  mirror.style.display = 'none';

  const mirrorContent = document.createElement('div');
  mirrorContent.className = 'local-grammar-mirror-content';
  mirror.appendChild(mirrorContent);

  document.body.appendChild(mirror);

  state = {
    debounceTimer: null,
    text: '',
    wordRanges: [],
    mismatches: [],
    mirror,
    mirrorContent
  };

  stateByElement.set(element, state);
  mirrorOwners.set(mirror, element);
  trackedElements.add(element);
  return state;
}

function hideTooltip() {
  tooltip.style.display = 'none';
  activeSuggestion = null;
}

function clearHighlights(element) {
  const state = stateByElement.get(element);
  if (!state) {
    return;
  }

  state.text = '';
  state.wordRanges = [];
  state.mismatches = [];
  state.mirrorContent.textContent = '';
  state.mirror.style.display = 'none';
  element.classList.remove('local-grammar-target');
  hideTooltip();
}

function syncMirrorLayout(element) {
  const state = stateByElement.get(element);
  if (!state || state.mirror.style.display === 'none') {
    return;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  state.mirror.style.left = `${rect.left + window.scrollX}px`;
  state.mirror.style.top = `${rect.top + window.scrollY}px`;
  state.mirror.style.width = `${rect.width}px`;
  state.mirror.style.height = `${rect.height}px`;
  state.mirror.style.padding = style.padding;
  state.mirror.style.fontFamily = style.fontFamily;
  state.mirror.style.fontSize = style.fontSize;
  state.mirror.style.fontWeight = style.fontWeight;
  state.mirror.style.fontStyle = style.fontStyle;
  state.mirror.style.lineHeight = style.lineHeight;
  state.mirror.style.letterSpacing = style.letterSpacing;
  state.mirror.style.borderRadius = style.borderRadius;
  state.mirror.style.textAlign = style.textAlign;
  state.mirror.style.direction = style.direction;
  state.mirror.scrollTop = element.scrollTop;
  state.mirror.scrollLeft = element.scrollLeft;
}

function renderMirror(element) {
  const state = stateByElement.get(element);
  if (!state || state.mismatches.length === 0) {
    clearHighlights(element);
    return;
  }

  const mismatchByIndex = new Map(state.mismatches.map((item) => [item.index, item]));
  let html = '';
  let cursor = 0;

  state.wordRanges.forEach((range, wordIndex) => {
    if (cursor < range.start) {
      html += escapeHtml(state.text.slice(cursor, range.start));
    }

    const currentWord = state.text.slice(range.start, range.end);
    const mismatch = mismatchByIndex.get(wordIndex);
    if (mismatch) {
      html += `<span class="local-grammar-error" data-word-index="${wordIndex}" data-suggestion="${escapeHtml(
        mismatch.suggestion
      )}">${escapeHtml(currentWord)}</span>`;
    } else {
      html += escapeHtml(currentWord);
    }

    cursor = range.end;
  });

  if (cursor < state.text.length) {
    html += escapeHtml(state.text.slice(cursor));
  }

  state.mirrorContent.innerHTML = html;
  state.mirror.style.display = 'block';
  element.classList.add('local-grammar-target');
  syncMirrorLayout(element);
}

async function runCorrection(element) {
  const state = ensureState(element);
  const currentText = getTextFromElement(element);
  state.text = currentText;
  state.wordRanges = buildWordRanges(currentText);

  if (!currentText.trim()) {
    clearHighlights(element);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'correct',
      text: currentText
    });

    if (!response || response.success !== true || typeof response.text !== 'string') {
      clearHighlights(element);
      return;
    }

    state.mismatches = computeWordDiffs(currentText, response.text);
    renderMirror(element);
  } catch {
    clearHighlights(element);
  }
}

function scheduleCorrection(element) {
  const state = ensureState(element);
  if (state.debounceTimer) {
    window.clearTimeout(state.debounceTimer);
  }

  state.debounceTimer = window.setTimeout(() => {
    runCorrection(element);
  }, DEBOUNCE_DELAY);
}

function replaceWord(element, wordIndex, suggestion) {
  const state = stateByElement.get(element);
  if (!state || !Number.isInteger(wordIndex) || !suggestion) {
    return;
  }

  const range = state.wordRanges[wordIndex];
  if (!range) {
    return;
  }

  const text = getTextFromElement(element);
  const updatedText = `${text.slice(0, range.start)}${suggestion}${text.slice(range.end)}`;
  setTextToElement(element, updatedText);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  clearHighlights(element);
}

document.addEventListener('focusin', (event) => {
  const target = findEditableTarget(event.target);
  if (!target || !isEditableElement(target)) {
    activeEditable = null;
    hideTooltip();
    return;
  }

  activeEditable = target;
  ensureState(target);
  syncMirrorLayout(target);
});

document.addEventListener('input', (event) => {
  const target = findEditableTarget(event.target);
  if (!target || !isEditableElement(target)) {
    return;
  }

  activeEditable = target;
  scheduleCorrection(target);
});

document.addEventListener(
  'scroll',
  () => {
    trackedElements.forEach((element) => syncMirrorLayout(element));
    hideTooltip();
  },
  true
);

window.addEventListener('resize', () => {
  trackedElements.forEach((element) => syncMirrorLayout(element));
  hideTooltip();
});

document.addEventListener('mousemove', (event) => {
  const hoveredError = event.target instanceof Element ? event.target.closest('.local-grammar-error') : null;
  if (!hoveredError || !(hoveredError instanceof HTMLElement)) {
    hideTooltip();
    return;
  }

  const mirror = hoveredError.closest('.local-grammar-mirror');
  if (!mirror || !(mirror instanceof HTMLElement)) {
    hideTooltip();
    return;
  }

  const owner = mirrorOwners.get(mirror);
  const wordIndex = Number.parseInt(hoveredError.dataset.wordIndex ?? '', 10);
  const suggestion = hoveredError.dataset.suggestion ?? '';
  if (!owner || !Number.isInteger(wordIndex) || !suggestion) {
    hideTooltip();
    return;
  }

  activeSuggestion = { element: owner, wordIndex, suggestion };
  tooltip.textContent = suggestion;
  tooltip.style.display = 'block';

  const hoverRect = hoveredError.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const top = hoverRect.top - tooltipRect.height - 8 > 8 ? hoverRect.top - tooltipRect.height - 8 : hoverRect.bottom + 8;
  const left = Math.max(8, Math.min(hoverRect.left, window.innerWidth - tooltipRect.width - 8));
  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.left = `${left + window.scrollX}px`;
});

tooltip.addEventListener('click', () => {
  if (!activeSuggestion) {
    return;
  }

  replaceWord(activeSuggestion.element, activeSuggestion.wordIndex, activeSuggestion.suggestion);
});
