const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  localSettings: {
    request: (pathname, body) =>
      ipcRenderer.invoke("desktop.localSettings.request", pathname, body),
  },
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  clientBrowser: {
    importChrome: () => ipcRenderer.invoke("desktop.clientBrowser.importChrome"),
    clearData: (mode) => ipcRenderer.invoke("desktop.clientBrowser.clearData", { mode }),
    runJs: (payload) => ipcRenderer.invoke("desktop.clientBrowser.runJs", payload),
    show: (bounds) => ipcRenderer.invoke("desktop.clientBrowser.show", bounds),
    hide: () => ipcRenderer.invoke("desktop.clientBrowser.hide"),
    navigate: (url) => ipcRenderer.invoke("desktop.clientBrowser.navigate", { url }),
    action: (verb) => ipcRenderer.invoke("desktop.clientBrowser.action", { verb }),
    state: () => ipcRenderer.invoke("desktop.clientBrowser.state"),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("desktop.clientBrowser.state", handler);
      return () => ipcRenderer.off("desktop.clientBrowser.state", handler);
    },
  },
  oauth: {
    open: (url) => ipcRenderer.invoke("desktop.oauth.open", url),
    cancel: (url) => ipcRenderer.invoke("desktop.oauth.cancel", url),
    onCallback: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the code.
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
});
