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
