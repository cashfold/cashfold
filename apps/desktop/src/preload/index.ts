import { contextBridge, ipcRenderer } from 'electron';
import { installBridge } from './bridge';

installBridge(contextBridge, ipcRenderer);
