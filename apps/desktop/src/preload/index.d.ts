export {}

declare global {
  interface Window {
    textpro: import('./index').TextProAPI
  }
}
