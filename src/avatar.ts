/** Decode only bounded raster image data, never forward a message-provided URL. */
export function decodeAvatar(
  value: unknown,
): { bytes: Uint8Array<ArrayBuffer>; mime: string } | undefined {
  if (typeof value !== "string" || value.length > 180_000) return;
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return;
  const mime = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[
    match[1]
  ];
  if (!mime) return;
  try {
    return { bytes: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)), mime };
  } catch {
    return;
  }
}
