const getMsg = (name) => chrome.i18n.getMessage(name) || "";

const toggle = document.getElementById("mainToggle");
const toggleTitle = document.getElementById("toggleTitle");
const toggleLabel = document.querySelector('label[for="mainToggle"]');
const toggleSub = document.getElementById("toggleSub");
const openSearchPrefs = document.getElementById("openSearchPrefs");
const prefsHint = document.getElementById("prefsHint");
let prefsHintTimer = 0;

function localizePopup() {
  toggleTitle.textContent = getMsg("popupToggleTitle");
  openSearchPrefs.textContent = getMsg("popupPrefsButton");
  toggleLabel.setAttribute("aria-label", getMsg("popupToggleAria"));
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
localizePopup();

/** Firefox blocks extensions from opening about:preferences via tabs.create (privileged about: URLs). */
const SEARCH_SETTINGS_PASTE = "about:preferences#search";

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_e2) {
      return false;
    }
  }
}
function applyUI(enabled) {
  toggle.checked = enabled;
  if (enabled) {
    toggleSub.textContent = "";
  } else {
    toggleSub.textContent = getMsg("popupToggleOffSub");
  }
}
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  applyUI(enabled);
});
toggle.addEventListener("change", () => {
  const enabled = toggle.checked;
  applyUI(enabled);
  chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled });
});
openSearchPrefs.addEventListener("click", async () => {
  const ok = await copyTextToClipboard(SEARCH_SETTINGS_PASTE);
  prefsHint.textContent = ok
    ? getMsg("popupPrefsCopied")
    : getMsg("popupPrefsCopyFailed");
  prefsHint.hidden = false;
  window.clearTimeout(prefsHintTimer);
  prefsHintTimer = window.setTimeout(() => {
    prefsHint.hidden = true;
    prefsHint.textContent = "";
  }, 6000);
});
