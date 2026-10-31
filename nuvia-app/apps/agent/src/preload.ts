import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nuvia', {
  answer: (promptId: string, answer?: string): Promise<string | null> => ipcRenderer.invoke('prompt:answer', promptId, answer),
  enroll: (serverUrl: string, orgId: string, password: string): Promise<string | null> => ipcRenderer.invoke('enroll:submit', serverUrl, orgId, password),
  onPrompt: (cb: (p: unknown) => void) => ipcRenderer.on('prompt', (_e, p) => cb(p)),
});
