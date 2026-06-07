# Virtual Try‑On — Foundation, Blush, Lipstick & Lipliner

This is a browser‑based virtual makeup try‑on powered by [MediaPipe FaceMesh](https://github.com/google/mediapipe).  
The app detects a face from the camera and lets you apply foundation, blush, lipstick, lip liner, and gloss in real time.

**Live demo:**  
👉 [https://pavlokovalua-hub.github.io/silver-octo-goggles/](https://pavlokovalua-hub.github.io/silver-octo-goggles/)

---

## URL Parameters

You can pre‑select a specific product (sku) by adding a query parameter.  
When a product SKU is present, the tone picker shows three color zones:

| Zone | Meaning |
|------|---------|
| ✅ **Safe** | The exact selected tone |
| 🟢 **Green** | 2 tones before + 2 tones after – very likely to match |
| 🟡 **Unpredictable** | All other tones – may give unexpected results |

### `foundation-product-sku`

URL: `https://pavlokovalua-hub.github.io/silver-octo-goggles/?foundation-product-sku=212-660XX`

| SKU | Lightness |
|-----|-----------|
| 212-66005 | Lightest |
| 212-66010 | |
| 212-66015 | |
| 212-66020 | |
| 212-66025 | |
| 212-66030 | |
| … | … |
| 212-66250 | Deepest |

**Example:** [Open with foundation 212-66160](https://pavlokovalua-hub.github.io/silver-octo-goggles/?foundation-product-sku=212-66160)

### `blush-product-sku`

URL: `https://pavlokovalua-hub.github.io/silver-octo-goggles/?blush-product-sku=212-155XX`

| SKU | Name |
|-----|------|
| 212-15501 | Lady Marmalade |
| 212-15502 | Warmth |
| 212-15503 | Big Spender (default) |
| 212-15504 | … |
| 212-15505 | Isla Bonita |
| 212-15506 | Bootylish |

**Example:** [Open with blush Isla Bonita](https://pavlokovalua-hub.github.io/silver-octo-goggles/?blush-product-sku=212-15505)

### `lipstick-product-sku`

URL: `https://pavlokovalua-hub.github.io/silver-octo-goggles/?lipstick-product-sku=212-127XX`

| SKU | Name |
|-----|------|
| 212-12701 | William |
| 212-12702 | … |
| 212-12703 | Ariadna |
| 212-12704 | Bella |
| 212-12705 | … |
| 212-12716 | Betty |
| 212-12717 | Averie |

**Example:** [Open with lipstick Ariadna](https://pavlokovalua-hub.github.io/silver-octo-goggles/?lipstick-product-sku=212-12703)

### `lipliner-product-sku`

URL: `https://pavlokovalua-hub.github.io/silver-octo-goggles/?lipliner-product-sku=212-519XXX`

| SKU | Name |
|-----|------|
| 212-519050 | Aubergine (matte finish) |
| 212-519053 | Antique pink (matte finish) |
| 212-519072 | Bazooka (matte finish) |
| 212-519075 | Yummy (semi matte finish) |
| 212-519076 | Boo boo (matte finish) |

**Example:** [Open with lipliner Aubergine](https://pavlokovalua-hub.github.io/silver-octo-goggles/?lipliner-product-sku=212-519050)

---

## Combining Parameters

You can combine multiple parameters:

```
?foundation-product-sku=212-66160&blush-product-sku=212-15505&lipstick-product-sku=212-12703&lipliner-product-sku=212-519050
```

**Example:** [Open with all products selected](https://pavlokovalua-hub.github.io/silver-octo-goggles/?foundation-product-sku=212-66160&blush-product-sku=212-15505&lipstick-product-sku=212-12703&lipliner-product-sku=212-519050)

---

## Running Locally

```bash
cd foundation-try-on
npm install
npx vite --host
```

The app starts at `https://localhost:5173/silver-octo-goggles/` (HTTPS is required for camera access).

---

## Tech Stack

- **React 18** – UI framework
- **MediaPipe FaceMesh** – 468 facial landmarks
- **Canvas 2D** – Real‑time makeup rendering with composite operations (multiply, screen, overlay, destination‑out)
- **WASM‑based skin smoothing** – Custom C++ module compiled to WebAssembly
- **Vite** – Dev server & bundler

---

## Integration into a Third‑Party Website

This project can be embedded into any existing website, similar to Angular Elements (custom elements / web components). Below are several integration strategies — from simplest (iframe) to most tightly integrated (custom element).

> ⚠️ **Important:** The app requires **HTTPS** to access the camera via `getUserMedia`. The host page **must** be served over HTTPS (or `localhost`).

---

### 1. `<iframe>` Embedding (Simplest)

The quickest way is to embed the standalone app via an `<iframe>`. You can control the initial state via URL parameters (see [URL Parameters](#url-parameters) section).

```html
<iframe
  src="https://pavlokovalua-hub.github.io/silver-octo-goggles/?foundation-product-sku=212-66160"
  width="100%"
  height="700"
  style="border: none; border-radius: 12px;"
  allow="camera; microphone"
  loading="lazy"
></iframe>
```

**Pros:**
- Trivial to set up — no build steps
- Fully isolated (CSS, JS don't leak)
- Works with any CMS or static site

**Cons:**
- Limited communication with the host page (postMessage API can be used — see below)
- The iframe has its own full UI (not just the makeup view)

#### Communication via `postMessage`

You can send configuration to the iframe and receive events from it:

```javascript
const iframe = document.querySelector('iframe');

// Send configuration to the iframe
iframe.contentWindow.postMessage({
  type: 'configure',
  payload: {
    foundationColor: '#f3cfb3',
    lipColor: '#BD2846',
    showFoundation: true,
    showLip: true,
    showBlush: false,
  }
}, '*');

// Listen for events from the iframe
window.addEventListener('message', (event) => {
  if (event.data?.type === 'tryon:stateChange') {
    console.log('Makeup state changed:', event.data.payload);
  }
  if (event.data?.type === 'tryon:screenshot') {
    console.log('Screenshot taken:', event.data.payload.dataUrl);
  }
});
```

---

### 2. Web Component (Custom Element) — Recommended for Tight Integration

Package the app as a standard HTML custom element (`<virtual-try-on>`) that can be dropped into any HTML page. This approach uses Vite's **library mode** combined with a lightweight web component wrapper.

#### Step 1: Install dependencies

```bash
cd foundation-try-on
npm install
```

#### Step 2: Create a web component wrapper — `src/virtual-try-on-element.jsx`

Create a file that exports a custom element wrapping the React app.  
It will automatically inject the CSS and load MediaPipe scripts from CDN.

The file already exists in the repository — you can use it directly:

```jsx
// src/virtual-try-on-element.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Use scoped styles (no global body/html/#root leakage)
import './virtual-try-on.css';

const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

function injectCSS(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = url;
  document.head.appendChild(link);
}

function getScriptDir() {
  const scripts = document.getElementsByTagName('script');
  const src = scripts[scripts.length - 1]?.src || '';
  return src.includes('/') ? src.substring(0, src.lastIndexOf('/')) : '.';
}

class VirtualTryOnElement extends HTMLElement {
  constructor() { super(); this._root = null; this._initialized = false; }

  async connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;

    // Read attributes
    const attrs = ['foundation-product-sku','blush-product-sku','lipstick-product-sku','lipliner-product-sku'];
    const url = new URL(window.location);
    let changed = false;
    for (const attr of attrs) {
      const val = this.getAttribute(attr);
      if (val) { url.searchParams.set(attr, val); changed = true; }
    }
    if (changed) window.history.replaceState({}, '', url);

    try {
      injectCSS(`${getScriptDir()}/style.css`);
      await Promise.all(MEDIAPIPE_SCRIPTS.map(loadScript));
      this._root = ReactDOM.createRoot(this);
      this._root.render(<App />);
    } catch (err) {
      this.innerHTML = `<div style="padding:2rem;text-align:center;color:#f87171;background:#1a1a2e;border-radius:12px;">
        <h3>⚠️ Failed to load</h3><p style="color:rgba(255,255,255,0.6)">${err.message}</p></div>`;
    }
  }

  disconnectedCallback() {
    if (this._root) { this._root.unmount(); this._root = null; }
  }
}

if (!customElements.get('virtual-try-on')) {
  customElements.define('virtual-try-on', VirtualTryOnElement);
}
export default VirtualTryOnElement;
```


#### Step 3: Build config (already in repo — `vite.lib.config.js`)

The repository includes a dedicated Vite config for the library build.  
It defines `process.env.NODE_ENV` to avoid the "process is not defined" error in the browser.

```js
// vite.lib.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: {
      entry: 'src/virtual-try-on-element.jsx',
      name: 'VirtualTryOn',
      formats: ['iife'],
      fileName: () => 'virtual-try-on.js',
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
```

#### Step 4: Build the web component

```bash
npx vite build --config vite.lib.config.js
```


The output will be in `dist/virtual-try-on.js` — a single self-contained script.

#### Step 5: Use the custom element on any page

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Load the web component script -->
  <script src="/path/to/virtual-try-on.js"></script>
</head>
<body>
  <!-- Use it as a standard HTML element -->
  <virtual-try-on
    foundation-product-sku="212-66160"
    blush-product-sku="212-15505"
    lipstick-product-sku="212-12703"
    lipliner-product-sku="212-519050"
    style="width: 100%; height: 700px; display: block;"
  ></virtual-try-on>
</body>
</html>
```

**Pros:**
- Fully encapsulated — no CSS or JS conflicts
- Works with any framework (React, Vue, Angular, vanilla HTML)
- Fine-grained control via HTML attributes

**Cons:**
- Requires a build step (but already part of your workflow)
- The script is self-contained (React is bundled inside) → larger file (~200–300 KB gzipped)

#### Optional: Externalize React for a smaller bundle

If the host page already uses React, you can exclude it from the bundle:

```js
// vite.config.js — externalize React
build: {
  lib: {
    entry: 'src/virtual-try-on-element.jsx',
    name: 'VirtualTryOn',
    formats: ['iife'],
    fileName: () => 'virtual-try-on.js',
  },
  rollupOptions: {
    external: ['react', 'react-dom'],
    output: {
      globals: {
        react: 'React',
        'react-dom': 'ReactDOM',
      },
    },
  },
},
```

Then the host page must include React before the widget:

```html
<script crossorigin src="https://unpkg.com/react@19/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"></script>
<script src="/path/to/virtual-try-on.js"></script>
```

---

### 3. Direct Script Embedding (Global Function)

For even simpler adoption without custom element registration, expose a global function that mounts the app into a given container.

#### Create `src/embed.jsx`

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

window.VirtualTryOn = {
  mount(container, options = {}) {
    // Set URL params from options
    const url = new URL(window.location);
    if (options.foundationProductSku) url.searchParams.set('foundation-product-sku', options.foundationProductSku);
    if (options.blushProductSku) url.searchParams.set('blush-product-sku', options.blushProductSku);
    if (options.lipstickProductSku) url.searchParams.set('lipstick-product-sku', options.lipstickProductSku);
    if (options.liplinerProductSku) url.searchParams.set('lipliner-product-sku', options.liplinerProductSku);
    window.history.replaceState({}, '', url);

    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    return root;
  },
};
```

Build with Vite library mode pointing to `src/embed.jsx`, then use:

```html
<div id="tryon-container"></div>
<script src="/path/to/virtual-try-on.umd.js"></script>
<script>
  VirtualTryOn.mount(document.getElementById('tryon-container'), {
    foundationProductSku: '212-66160',
    blushProductSku: '212-15505',
  });
</script>
```

---

### 4. Extending `postMessage` API (for iframe embed)

To make the iframe approach more interactive, extend the `App.jsx` to listen for and respond to `postMessage` events. Add this at the end of the `useEffect` in `App.jsx`:

```javascript
// Listen for configuration messages from the parent page
const handleMessage = (event) => {
  if (event.data?.type === 'configure') {
    const { foundationColor, lipColor, showFoundation, showLip } = event.data.payload;
    if (foundationColor) setFoundationColor(foundationColor);
    if (lipColor) setLipColor(lipColor);
    if (showFoundation !== undefined) setShowFoundation(showFoundation);
    if (showLip !== undefined) setShowLip(showLip);
  }
};
window.addEventListener('message', handleMessage);

return () => {
  window.removeEventListener('message', handleMessage);
};
```

And to notify the parent of state changes, add this effect:

```javascript
useEffect(() => {
  if (window.parent !== window) {
    window.parent.postMessage({
      type: 'tryon:stateChange',
      payload: {
        foundationColor,
        lipColor,
        blushColor,
        showFoundation,
        showLip,
        showBlush,
        showLipLiner,
      }
    }, '*');
  }
}, [foundationColor, lipColor, blushColor, showFoundation, showLip, showBlush, showLipLiner]);
```

---

### Summary: Which Approach to Choose

| Approach | Complexity | Bundle Size | Integration | Best For |
|----------|-----------|------------|-------------|----------|
| **iframe** | None | N/A (hosted separately) | Loose isolation | Quick embed, CMS/Shopify |
| **Web Component** | Medium | ~200-300 KB gzipped | Tight, encapsulated | SPA sites, product pages |
| **Script embed** | Low-Medium | ~200-300 KB gzipped | Simple global function | Vanilla HTML sites |
| **Externalized WC** | Medium | ~30 KB (React external) | Tight, smaller bundle | Host already uses React |

> 💡 **Recommendation:** Start with the **iframe** approach for speed, then migrate to a **Web Component** if you need tighter integration.

