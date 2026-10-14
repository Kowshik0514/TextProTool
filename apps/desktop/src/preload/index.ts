import { contextBridge, ipcRenderer } from 'electron'
import type { Action, AppSettings, Category, UserVariable } from '@textpro/core'

export interface TextProAPI {
  searchActions: (query: string) => Promise<Action[]>
  listActions: () => Promise<Action[]>
  getAction: (id: string) => Promise<Action | null>
  createAction: (input: Record<string, unknown>) => Promise<Action>
  updateAction: (id: string, input: Record<string, unknown>) => Promise<Action>
  deleteAction: (id: string) => Promise<boolean>
  runAction: (id: string) => Promise<{ ok: boolean; message?: string; error?: string }>
  previewAction: (id: string, prompts?: Record<string, string>) => Promise<string>

  listCategories: () => Promise<Category[]>
  createCategory: (name: string) => Promise<Category>
  updateCategory: (
    id: string,
    input: Partial<{ name: string; enabled: boolean; sortOrder: number }>,
  ) => Promise<Category>
  deleteCategory: (id: string) => Promise<boolean>

  listVariables: () => Promise<UserVariable[]>
  setVariable: (name: string, value: string) => Promise<UserVariable>
  deleteVariable: (name: string) => Promise<boolean>

  getSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>

  hidePalette: () => Promise<boolean>
  showManager: () => Promise<boolean>

  submitPrompt: (values: Record<string, string>) => Promise<boolean>
  cancelPrompt: () => Promise<boolean>
  onPromptFields: (cb: (fields: Array<{ key: string; label: string }>) => void) => () => void
  onPaletteFocus: (cb: () => void) => () => void

  exportData: () => Promise<{ ok: boolean; path?: string }>
  importData: () => Promise<{ ok: boolean; count?: number }>

  listPlugins: () => Promise<Array<{ id: string; name: string; version?: string }>>
  listHistory: () => Promise<Array<{ actionId: string; ranAt: string; ok: boolean; message?: string }>>
}

const api: TextProAPI = {
  searchActions: (query) => ipcRenderer.invoke('actions:search', query),
  listActions: () => ipcRenderer.invoke('actions:list'),
  getAction: (id) => ipcRenderer.invoke('actions:get', id),
  createAction: (input) => ipcRenderer.invoke('actions:create', input),
  updateAction: (id, input) => ipcRenderer.invoke('actions:update', id, input),
  deleteAction: (id) => ipcRenderer.invoke('actions:delete', id),
  runAction: (id) => ipcRenderer.invoke('actions:run', id),
  previewAction: (id, prompts) => ipcRenderer.invoke('actions:preview', id, prompts),

  listCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (name) => ipcRenderer.invoke('categories:create', name),
  updateCategory: (id, input) => ipcRenderer.invoke('categories:update', id, input),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),

  listVariables: () => ipcRenderer.invoke('variables:list'),
  setVariable: (name, value) => ipcRenderer.invoke('variables:set', name, value),
  deleteVariable: (name) => ipcRenderer.invoke('variables:delete', name),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),

  hidePalette: () => ipcRenderer.invoke('palette:hide'),
  showManager: () => ipcRenderer.invoke('manager:show'),

  submitPrompt: (values) => ipcRenderer.invoke('prompt:submit', values),
  cancelPrompt: () => ipcRenderer.invoke('prompt:cancel'),
  onPromptFields: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, fields: Array<{ key: string; label: string }>) =>
      cb(fields)
    ipcRenderer.on('prompt:fields', listener)
    return () => ipcRenderer.removeListener('prompt:fields', listener)
  },
  onPaletteFocus: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('palette:focus', listener)
    return () => ipcRenderer.removeListener('palette:focus', listener)
  },

  exportData: () => ipcRenderer.invoke('export:save'),
  importData: () => ipcRenderer.invoke('import:load'),

  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  listHistory: () => ipcRenderer.invoke('history:list'),
}

contextBridge.exposeInMainWorld('textpro', api)
