// 拡張に同梱する固定SVG。外部データを混ぜず、受信アバターの検証も緩めない。
export const defaultAvatarSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" color="#808080" focusable="false">' +
  '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
  '<circle cx="12" cy="8.5" r="3.25"/>' +
  '<path d="M5.5 19.5a6.5 6.5 0 0 1 13 0A10 10 0 0 1 5.5 19.5Z"/></svg>';

export const defaultAvatarUri = `data:image/svg+xml;base64,${btoa(defaultAvatarSvg)}`;
