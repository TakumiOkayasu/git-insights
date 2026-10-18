import { decodeAvatar } from "../avatar";
import { defaultAvatarSvg } from "../default-avatar";

function defaultIcon() {
  const svg = new DOMParser().parseFromString(defaultAvatarSvg, "image/svg+xml").documentElement;
  // WebviewではVS Codeテーマの文字色を継承する。
  svg.removeAttribute("color");
  return svg;
}

export function createAvatar() {
  const element = document.createElement("span");
  element.className = "avatar";
  // 著者名は隣に表示されるため、画像と代替アイコンは装飾として扱う。
  element.setAttribute("aria-hidden", "true");
  let pending: { image: HTMLImageElement; url: string } | undefined;
  const cancel = () => {
    if (!pending) return;
    pending.image.onload = pending.image.onerror = null;
    URL.revokeObjectURL(pending.url);
    pending = undefined;
  };
  const reset = () => {
    cancel();
    element.replaceChildren(defaultIcon());
  };
  reset();
  return {
    element,
    reset,
    showImage(value: string) {
      const decoded = decodeAvatar(value);
      if (!decoded) return;
      reset();
      const image = document.createElement("img");
      const url = URL.createObjectURL(new Blob([decoded.bytes], { type: decoded.mime }));
      pending = { image, url };
      image.alt = "";
      image.onload = () => {
        if (pending?.image !== image) return;
        cancel();
        element.replaceChildren(image);
      };
      image.onerror = () => {
        if (pending?.image === image) cancel();
      };
      // 読み込み成功まではSVGを保ち、失敗時も壊れた画像を表示しない。
      image.src = url;
    },
  };
}
