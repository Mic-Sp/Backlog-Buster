"use client";

// Embed artwork before exporting: the serialized SVG never depends on remote resources.
export async function loadDossierArtwork(url: string, signal: AbortSignal): Promise<string | null> {
  let objectUrl: string | null = null;
  try {
    const response = url === "/hud-logo.png"
      ? await fetch(url, { signal, credentials: "same-origin" })
      : await fetch("/api/dossier-artwork", {
        method: "POST", signal, credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!/^image\/(png|jpeg|webp|avif|gif)$/.test(blob.type) || blob.size > 8 * 1024 * 1024) return null;
    objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error("Artwork loading cancelled."));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      void image.decode().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 25000000) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function captureDossierPng(card: SVGSVGElement): Promise<Blob> {
  const clone = card.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", "2000");
  clone.setAttribute("height", "1360");
  // All colors, fonts and geometry are SVG attributes, identical in preview and PNG.
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2000;
    canvas.height = 1360;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image capture is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the ID snapshot.")), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadDossier(blob: Blob, callsign: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const name = callsign.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "operator";
  link.download = `netrunner-id-${name}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive until the browser has started consuming the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
