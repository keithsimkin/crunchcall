/** Public folder paths that work under Vite HTTP and Electron loadFile (file://). */
export function publicAsset(path: string): string {
  const clean = path.replace(/^\//, '')
  return `./${clean}`
}
