// Opens the side panel from the toolbar button, and takes screenshots of the current tab for it.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      const tab = await activeTab();
      if (!tab) throw new Error('No tab to look at.');
      if (msg.type === 'capture') {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        reply({ ok: true, dataUrl, title: tab.title || '', url: tab.url || '' });
      } else if (msg.type === 'select') {
        // let the person drag a box on the page, then grab the screen
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['select.js'] });
        const rect = res && res.result;
        if (!rect) { reply({ ok: false, cancelled: true }); return; }
        await new Promise((r) => setTimeout(r, 120)); // let the overlay disappear first
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        reply({ ok: true, dataUrl, rect, title: tab.title || '', url: tab.url || '' });
      }
    } catch (e) {
      reply({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // async reply
});
