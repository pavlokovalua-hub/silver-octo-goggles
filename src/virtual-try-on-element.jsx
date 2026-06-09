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
// We look for the <script> tag that has 'virtual-try-on' in its src.
// This works even when connectedCallback fires asynchronously and
// document.currentScript is no longer available.
function getScriptDir() {
  // 1. Try document.currentScript first (works during synchronous execution)
  if (document.currentScript) {
    const src = document.currentScript.src;
    if (src) {
      return src.substring(0, src.lastIndexOf('/'));
    }
  }
  // 2. Find the script that registered the custom element (by src pattern)
  const scripts = document.querySelectorAll('script[src*="virtual-try-on"]');
  if (scripts.length > 0) {
    const src = scripts[scripts.length - 1].src;
    return src.substring(0, src.lastIndexOf('/'));
  }
  // 3. Fallback to the last script with a non-empty src
  const allScripts = document.getElementsByTagName('script');
  for (let i = allScripts.length - 1; i >= 0; i--) {
    const src = allScripts[i].src;
    if (src) {
      return src.substring(0, src.lastIndexOf('/'));
    }
  }
  return '.';
}

class VirtualTryOnElement extends HTMLElement {
  constructor() {
    super();
    this._root = null;
    this._isInitializing = false;
    this._resizeObserver = null;

    // ── Breakpoint for mobile vs desktop layout ──
    // Замість @media (max-width: 1023px) ми використовуємо клас .vto-mobile,
    // який додається на цей елемент на основі ширини самого блоку (не екрану).
    this._mobileBreakpoint = 1024;
  }

  /**
   * ── ResizeObserver: стежить за шириною цього елементу ──
   * Якщо ширина < _mobileBreakpoint — додаємо клас .vto-mobile,
   * інакше — прибираємо. CSS використовує цей клас замість @media.
   */
  _updateLayoutClass() {
    const width = this.offsetWidth;
    const isNarrow = width < this._mobileBreakpoint;
    this.classList.toggle('vto-mobile', isNarrow);
  }

  async connectedCallback() {
    // Prevent double initialization
    if (this._root || this._isInitializing) return;
    this._isInitializing = true;

    // ── Run ResizeObserver on this element ──
    this._updateLayoutClass();
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        this._updateLayoutClass();
      });
      this._resizeObserver.observe(this);
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

      // 4. Mount React app (only once), passing product SKUs as props (not via URL)
      if (!this._root) {
        this._root = ReactDOM.createRoot(this);
        this._root.render(
          <App
            foundationProductSku={this.getAttribute('foundation-product-sku') || undefined}
            blushProductSku={this.getAttribute('blush-product-sku') || undefined}
            lipstickProductSku={this.getAttribute('lipstick-product-sku') || undefined}
            liplinerProductSku={this.getAttribute('lipliner-product-sku') || undefined}
            recomendedFoundationSku={this.getAttribute('recomended-foundation-sku') || undefined}
          />
        );
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
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
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
