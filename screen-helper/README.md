# Screen Helper (Chrome extension)

Snap your screen (or drag a box around part of it), ask a question, and Claude explains it.

- **📸 Whole screen** or **✂️ Select area** to show it what you're looking at
- **🧠 Explain** mode walks through things step by step; **⚡ Quick** gives a short answer
- Ask follow-up questions in the same chat
- Shortcut: **Alt+Shift+S** opens it

## Install

1. Download `screen-helper.zip` and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `screen-helper` folder.
4. Pin it, click the icon, open ⚙️ and paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com/settings/keys).

The key stays in your browser and is only sent to Anthropic. Chrome doesn't let extensions see its own
pages (`chrome://…`, the Web Store), so use it on normal websites.

## Building

`src/panel.js` is the source; `panel.js` is the bundle with the Anthropic SDK:

    npm i esbuild @anthropic-ai/sdk && node build.mjs
