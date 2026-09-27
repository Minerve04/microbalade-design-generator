import QRCode from "qrcode";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const LOGO_RATIO = 0.22; // logo width ≤ 22 % of the QR width

/** Strip "Mairie de", "Ville de", "Commune de" prefixes. */
export function cleanCommuneName(name: string) {
  return name.replace(/^(mairie|ville|commune)\s+(de\s+la\s+|de\s+l'|d'|de\s+|du\s+|des\s+)?/i, "").trim() || name;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function isValidHex(hex: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}
/** WCAG contrast ratio between a colour and white. */
export function contrastWithWhite(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (L + 0.05);
}
export const MIN_CONTRAST = 4.5;

const toPdfColor = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r / 255, g / 255, b / 255);
};

const roundedRectPath = (w: number, h: number, r: number) =>
  `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;

/** Draw a rounded rect whose top-left corner is (x, yTop) in PDF coords (origin bottom-left). */
function drawRounded(page: PDFPage, x: number, yTop: number, w: number, h: number, r: number, color: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>) {
  page.drawSvgPath(roundedRectPath(w, h, r), { x, y: yTop, color, borderColor: border, borderWidth: border ? 0.8 : 0 });
}

/** Vector QR modules drawn directly in the PDF (sharp at any size). */
function drawQr(page: PDFPage, text: string, x: number, yTop: number, size: number, color: string, clearCenterRatio: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const cell = size / n;
  const col = toPdfColor(color);
  const c0 = (n * (1 - clearCenterRatio)) / 2;
  const c1 = n - c0;
  for (let row = 0; row < n; row++) {
    let runStart = -1;
    for (let colI = 0; colI <= n; colI++) {
      const inCenter = clearCenterRatio > 0 && row >= c0 - 0.5 && row < c1 + 0.5 && colI >= c0 - 0.5 && colI < c1 + 0.5;
      const dark = colI < n && qr.modules.get(row, colI) && !inCenter;
      if (dark && runStart < 0) runStart = colI;
      if (!dark && runStart >= 0) {
        page.drawRectangle({
          x: x + runStart * cell,
          y: yTop - (row + 1) * cell,
          width: (colI - runStart) * cell + 0.05,
          height: cell + 0.05,
          color: col,
        });
        runStart = -1;
      }
    }
  }
}

function wrap(text: string, font: PDFFont, size: number, maxW: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function centerText(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color: ReturnType<typeof rgb>) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

function fitImage(img: PDFImage, maxW: number, maxH: number) {
  const s = Math.min(maxW / img.width, maxH / img.height);
  return { width: img.width * s, height: img.height * s };
}

export interface PosterInput {
  format: "A4" | "A5";
  url: string; // full URL encoded in the QR
  shortUrl: string; // shown in clear
  communeName: string;
  qrColor: string;
  townLogo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  microLogo: Uint8Array; // PNG
  fonts: { regular: Uint8Array; semibold: Uint8Array; extrabold: Uint8Array };
}

export async function buildPoster(input: PosterInput): Promise<Uint8Array> {
  const W = input.format === "A4" ? 595.28 : 419.53;
  const H = input.format === "A4" ? 841.89 : 595.28;
  const s = W / 595.28;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Affichette Microbalade — ${input.communeName}`);
  const [fReg, fSemi, fXb] = await Promise.all([
    doc.embedFont(input.fonts.regular, { subset: true }),
    doc.embedFont(input.fonts.semibold, { subset: true }),
    doc.embedFont(input.fonts.extrabold, { subset: true }),
  ]);
  const page = doc.addPage([W, H]);
  const bg = toPdfColor("#FAF8F5");
  const orange = toPdfColor("#E8622A");
  const ink = toPdfColor("#1F1A17");
  const grey = toPdfColor("#6B635C");
  const white = rgb(1, 1, 1);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: bg });
  page.drawRectangle({ x: 0, y: H - 8 * s, width: W, height: 8 * s, color: orange });

  let y = H - 50 * s;

  // Town logo
  if (input.townLogo) {
    const img = input.townLogo.type === "png" ? await doc.embedPng(input.townLogo.bytes) : await doc.embedJpg(input.townLogo.bytes);
    const d = fitImage(img, 220 * s, 90 * s);
    page.drawImage(img, { x: (W - d.width) / 2, y: y - d.height, ...d });
    y -= d.height + 34 * s;
  } else {
    y -= 20 * s;
  }

  // Title
  const titleSize = 30 * s;
  for (const line of wrap("Une balade de 15 min à 2 h, tout près d'ici", fXb, titleSize, W - 110 * s)) {
    y -= titleSize;
    centerText(page, line, fXb, titleSize, y, ink);
    y -= 6 * s;
  }
  y -= 12 * s;
  const subSize = 15 * s;
  y -= subSize;
  centerText(page, "Scannez, choisissez votre temps, laissez-vous guider.", fReg, subSize, y, grey);
  y -= 30 * s;

  // QR card
  const card = 320 * s;
  const pad = 20 * s;
  const cardX = (W - card) / 2;
  drawRounded(page, cardX, y, card, card, 18 * s, white, toPdfColor("#E9E3DC"));
  const qrSize = card - pad * 2;
  const hasLogo = !!input.townLogo;
  drawQr(page, input.url, cardX + pad, y - pad, qrSize, input.qrColor, hasLogo ? LOGO_RATIO + 0.04 : 0);
  if (input.townLogo) {
    const img = input.townLogo.type === "png" ? await doc.embedPng(input.townLogo.bytes) : await doc.embedJpg(input.townLogo.bytes);
    const box = qrSize * LOGO_RATIO;
    const bx = cardX + pad + (qrSize - box) / 2;
    const byTop = y - pad - (qrSize - box) / 2;
    drawRounded(page, bx - 3 * s, byTop + 3 * s, box + 6 * s, box + 6 * s, 8 * s, white);
    const d = fitImage(img, box, box);
    page.drawImage(img, { x: bx + (box - d.width) / 2, y: byTop - box + (box - d.height) / 2, ...d });
  }
  y -= card + 34 * s;

  // Short URL
  const urlSize = 22 * s;
  y -= urlSize;
  centerText(page, input.shortUrl, fSemi, urlSize, y, orange);
  y -= 26 * s;
  const mSize = 12 * s;
  y -= mSize;
  centerText(page, `Gratuit · Sans application · Proposé par la Ville de ${input.communeName}`, fReg, mSize, y, grey);

  // Microbalade footer
  const micro = await doc.embedPng(input.microLogo);
  const md = fitImage(micro, 60 * s, 22 * s);
  const label = "Microbalade";
  const lSize = 11 * s;
  const lw = fSemi.widthOfTextAtSize(label, lSize);
  const total = md.width + 6 * s + lw;
  const fx = (W - total) / 2;
  const fy = 30 * s;
  page.drawImage(micro, { x: fx, y: fy, ...md });
  page.drawText(label, { x: fx + md.width + 6 * s, y: fy + (md.height - lSize) / 2 + 2 * s, size: lSize, font: fSemi, color: grey });

  return doc.save();
}
