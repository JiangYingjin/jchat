export function fetch(url: string, options?: RequestInit): Promise<Response> {
  return window.fetch(url, options);
}
