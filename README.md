# Local-First Grammar Corrector (Chrome Extension, MV3)

This project is a private, client-side Chrome Extension that performs on-device grammar correction with Transformers.js v3 using WebGPU acceleration.

## 1. Install dependencies

```bash
npm install
```

## 2. Build the extension

```bash
npm run build
```

This creates a `dist/` folder containing:
- `manifest.json`
- `background.js` (service worker module)
- `popup.html`
- `popup.js`

## 3. Load unpacked extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` folder.

The extension icon opens the popup where you can submit text and receive corrected output locally.
