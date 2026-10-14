/// <reference types="vite/client" />

interface Window {
  textpro: {
    searchActions: (query: string) => Promise<import('@textpro/core').Action[]>
    listActions: () => Promise<import('@textpro/core').Action[]>
    getAction: (id: string) => Promise<import('@textpro/core').Action | null>
    createAction: (input: Record<string, unknown>) => Promise<import('@textpro/core').Action>
    updateAction: (
      id: string,
      input: Record<string, unknown>,
    ) => Promise<import('@textpro/core').Action>
    deleteAction: (id: string) => Promise<boolean>
    runAction: (id: string) => Promise<{ ok: boolean; message?: string; error?: string }>
    previewAction: (id: string, prompts?: Record<string, string>) => Promise<string>
    listCategories: () => Promise<import('@textpro/core').Category[]>
    createCategory: (name: string) => Promise<import('@textpro/core').Category>
    updateCategory: (
      id: string,
      input: Partial<{ name: string; enabled: boolean; sortOrder: number }>,
    ) => Promise<import('@textpro/core').Category>
    deleteCategory: (id: string) => Promise<boolean>
    listVariables: () => Promise<import('@textpro/core').UserVariable[]>
    setVariable: (name: string, value: string) => Promise<import('@textpro/core').UserVariable>
    deleteVariable: (name: string) => Promise<boolean>
    getSettings: () => Promise<import('@textpro/core').AppSettings>
    updateSettings: (
      partial: Partial<import('@textpro/core').AppSettings>,
    ) => Promise<import('@textpro/core').AppSettings>
    hidePalette: () => Promise<boolean>
    showManager: () => Promise<boolean>
    submitPrompt: (values: Record<string, string>) => Promise<boolean>
    cancelPrompt: () => Promise<boolean>
    onPromptFields: (
      cb: (fields: Array<{ key: string; label: string }>) => void,
    ) => () => void
    onPaletteFocus: (cb: () => void) => () => void
    exportData: () => Promise<{ ok: boolean; path?: string }>
    importData: () => Promise<{ ok: boolean; count?: number }>
    listPlugins: () => Promise<Array<{ id: string; name: string; version?: string }>>
    listHistory: () => Promise<
      Array<{ actionId: string; ranAt: string; ok: boolean; message?: string }>
    >
  }
}
