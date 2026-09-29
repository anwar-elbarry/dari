/** Builds the prefilled WhatsApp message. No phone number: WhatsApp lets the manager pick the contact. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Downloads a Blob under a fixed, non-identifying file name. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens a Blob in a new tab; falls back to a download only when the browser blocks the pop-up. The URL is revoked later.
 * Not `noopener` in the feature string: that makes window.open ALWAYS return null (per the HTML spec), which would
 * trigger the download fallback every time and write the file to disk. The opener link is cut by hand instead.
 */
export function openBlob(blob: Blob, fallbackName: string) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else downloadBlob(blob, fallbackName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
