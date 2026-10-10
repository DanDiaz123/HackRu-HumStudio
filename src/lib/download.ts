/** Save bytes or text as a file through a short-lived object URL (browser only). */
export function download(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  try {
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
  } finally {
    // Delay revocation until the browser has consumed the download, including failed clicks.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
