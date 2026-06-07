// src/virtual-try-on-element.jsx
// Web Component wrapper for the Virtual Try-On app.
// This self-contained custom element:
//   1. Injects the required CSS (built alongside the JS)
//   2. Loads MediaPipe FaceMesh & Camera scripts from CDN
//   3. Mounts the React app inside the element
//
// Usage in any HTML page:
//   <script src="dist/virtual-try-on.js"></script>
//   <virtual-try-on foundation-product-sku="212-66160"></virtual-try-on>

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Use scoped styles (no global body/html/#root leakage)
import './virtual-try-on.css';

/**
 * ── Deduplicate MediaPipe internal asset script tags ──
 *
 * MediaPipe's face_mesh.js auto-loads solution assets
 * (face_mesh_solution_packed_assets_loader.js, face_mesh_solution_simd_wasm_bin.js)
 * at evaluation time. Then new FaceMesh({locateFile}) ALSO loads them.
 *
 * This MutationObserver catches and removes any duplicate <script> tags
 * with the same MediaPipe asset src, ensuring each asset loads exactly once.
 */
(function() {
  if (window.__mediapipeDeduplicatorInstalled) return;
  window.__mediapipeDeduplicatorInstalled = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === 1 &&
          node.tagName === 'SCRIPT' &&
          node.src &&
          node.src.includes('/@mediapipe/')
        ) {
          const scripts = Array.from(document.querySelectorAll('script'));
          const duplicate = scripts.find(s => s !== node && s.src === node.src);
          if (duplicate) {
            node.remove();
          }
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

// ── CDN URLs for MediaPipe (must be loaded before the app starts) ──
const MEDIAPIPE_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
];

// ── Load a script dynamically and return a promise ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

// ── Inject CSS (the built style.css must be served alongside the JS) ──
function injectCSS(url) {
  if (document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

// ── Resolve the CSS path relative to the current script ──
function getScriptDir() {
  if (document.currentScript) {
    const src = document.currentScript.src;
    return src.substring(0, src.lastIndexOf('/'));
  }
  const scripts = document.getElementsByTagName('script');
  const currentScript = scripts[scripts.length - 1];
  const src = currentScript?.src || '';
  const idx = src.lastIndexOf('/');
  return idx !== -1 ? src.substring(0, idx) : '.';
}

class VirtualTryOnElement extends HTMLElement {
  constructor() {
    super();
    this._root = null;
    this._isInitializing = false;
  }

  async connectedCallback() {
    // Prevent double initialization
    if (this._root || this._isInitializing) return;
    this._isInitializing = true;

    // Set URL params from HTML attributes
    const url = new URL(window.location);
    let urlChanged = false;

    const setParam = (attr, paramName) => {
      const val = this.getAttribute(attr);
      if (val && url.searchParams.get(paramName) !== val) {
        url.searchParams.set(paramName, val);
        urlChanged = true;
      }
    };

    // setParam('foundation-product-sku', 'foundation-product-sku');
    // setParam('blush-product-sku', 'blush-product-sku');
    // setParam('lipstick-product-sku', 'lipstick-product-sku');
    // setParam('lipliner-product-sku', 'lipliner-product-sku');

    if (urlChanged) {
      window.history.replaceState({}, '', url);
    }

    try {
      // 1. Inject CSS (style.css lives next to virtual-try-on.js)
      const scriptDir = getScriptDir();
      injectCSS(`${scriptDir}/style.css`);

      // 2. Load MediaPipe scripts from CDN
      await Promise.all(MEDIAPIPE_SCRIPTS.map(loadScript));

      // 3. Verify element is still in the DOM
      if (!this.isConnected) {
        this._isInitializing = false;
        return;
      }

      // 4. Mount React app (only once)
      if (!this._root) {
        this._root = ReactDOM.createRoot(this);
        this._root.render(<App />);
      }
    } catch (err) {
      console.error('VirtualTryOnElement: failed to initialize', err);
      this.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: #f87171; background: #1a1a2e; border-radius: 12px;">
          <h3>⚠️ Failed to load Virtual Try-On</h3>
          <p style="color: rgba(255,255,255,0.6); font-size: 0.9rem; margin-top: 0.5rem;">
            ${err.message}
          </p>
        </div>
      `;
    } finally {
      this._isInitializing = false;
    }
  }

  disconnectedCallback() {
    if (this._root) {
      this._root.unmount();
      this._root = null;
    }
    this._isInitializing = false;
  }
}

// Define the custom element (only once)
if (!customElements.get('virtual-try-on')) {
  customElements.define('virtual-try-on', VirtualTryOnElement);
}

export default VirtualTryOnElement;
