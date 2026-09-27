import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Download, QrCode as QrIcon, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  LOGO_RATIO,
  MIN_CONTRAST,
  buildPoster,
  cleanCommuneName,
  contrastWithWhite,
  isValidHex,
} from "@/lib/qrPoster";

interface Props {
  communeName: string;
  slug: string | null;
  logoUrl: string | null;
}

const BASE = "https://microbalade.fr";

type LoadedLogo = { bitmap: ImageBitmap; dataUrl: string; pdf: { bytes: Uint8Array; type: "png" | "jpg" } };

async function loadLogo(url: string): Promise<LoadedLogo> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("logo");
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  // PNG bytes for PDF/SVG (works whatever the source format)
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  c.getContext("2d")!.drawImage(bitmap, 0, 0);
  const dataUrl = c.toDataURL("image/png");
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
  return { bitmap, dataUrl, pdf: { bytes, type: "png" } };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderCanvas(url: string, width: number, color: string, light: string, logo: LoadedLogo | null) {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, { width, margin: 2, errorCorrectionLevel: "H", color: { dark: color, light } });
  if (logo) {
    const ctx = canvas.getContext("2d")!;
    const box = canvas.width * LOGO_RATIO;
    const x = (canvas.width - box) / 2;
    const pad = box * 0.08;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x - pad, x - pad, box + pad * 2, box + pad * 2, box * 0.16);
    ctx.fill();
    const s = Math.min(box / logo.bitmap.width, box / logo.bitmap.height);
    const w = logo.bitmap.width * s;
    const h = logo.bitmap.height * s;
    ctx.drawImage(logo.bitmap, x + (box - w) / 2, x + (box - h) / 2, w, h);
  }
  return canvas;
}

async function fetchBytes(path: string) {
  const r = await fetch(path);
  return new Uint8Array(await r.arrayBuffer());
}

export default function CommuneQrCode({ communeName, slug, logoUrl }: Props) {
  const displayName = cleanCommuneName(communeName);
  const trackingUrl = slug ? `${BASE}/${slug}?src=qr` : `${BASE}/?src=qr`;
  const shortUrl = slug ? `microbalade.fr/${slug}` : "microbalade.fr";
  const fileBase = `microbalade-qr-${slug ?? "commune"}`;

  const [color, setColor] = useState("#0a0a0a");
  const [colorInput, setColorInput] = useState("#0a0a0a");
  const [withLogo, setWithLogo] = useState(!!logoUrl);
  const [logo, setLogo] = useState<LoadedLogo | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setWithLogo(!!logoUrl);
    if (!logoUrl) {
      setLogo(null);
      return;
    }
    let cancelled = false;
    loadLogo(logoUrl)
      .then((l) => !cancelled && setLogo(l))
      .catch(() => !cancelled && toast.error("Logo illisible : QR code généré sans logo."));
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const activeLogo = withLogo ? logo : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    renderCanvas(trackingUrl, 512, color, "#ffffff", activeLogo)
      .then((c) => !cancelled && setPreviewUrl(c.toDataURL("image/png")))
      .catch(() => toast.error("Impossible de générer le QR code."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [trackingUrl, color, activeLogo]);

  const applyColor = () => {
    const v = colorInput.trim();
    if (!isValidHex(v)) {
      toast.error("Couleur invalide : utilisez le format #RRGGBB.");
      return;
    }
    const ratio = contrastWithWhite(v);
    if (ratio < MIN_CONTRAST) {
      toast.error(
        `Couleur trop claire (contraste ${ratio.toFixed(1)}:1, minimum ${MIN_CONTRAST}:1) : le QR code risque de ne pas être lu. Choisissez une teinte plus foncée.`
      );
      return;
    }
    setColor(v);
    toast.success("Couleur appliquée.");
  };

  const triggerDownload = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadRaster = async (kind: "png" | "png-t" | "jpg") => {
    try {
      const c = await renderCanvas(trackingUrl, 2048, color, kind === "png-t" ? "#00000000" : "#ffffff", activeLogo);
      if (kind === "jpg") triggerDownload(c.toDataURL("image/jpeg", 0.95), `${fileBase}.jpg`);
      else triggerDownload(c.toDataURL("image/png"), `${fileBase}${kind === "png-t" ? "-transparent" : ""}.png`);
    } catch {
      toast.error("Erreur lors du téléchargement.");
    }
  };

  const downloadSvg = async () => {
    try {
      let svg = await QRCode.toString(trackingUrl, {
        type: "svg",
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: color, light: "#ffffff" },
      });
      if (activeLogo) {
        const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
        const n = vb ? Number(vb[1]) : 100;
        const box = n * LOGO_RATIO;
        const x = (n - box) / 2;
        const pad = box * 0.08;
        svg = svg.replace(
          "</svg>",
          `<rect x="${x - pad}" y="${x - pad}" width="${box + 2 * pad}" height="${box + 2 * pad}" rx="${box * 0.16}" fill="#ffffff"/>` +
            `<image x="${x}" y="${x}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" href="${activeLogo.dataUrl}"/></svg>`
        );
      }
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      triggerDownload(url, `${fileBase}.svg`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Erreur lors du téléchargement SVG.");
    }
  };

  const downloadPoster = async (format: "A4" | "A5") => {
    setBusy(format);
    try {
      const [regular, semibold, extrabold, microLogo] = await Promise.all([
        fetchBytes("/fonts/Inter-Regular.ttf"),
        fetchBytes("/fonts/Inter-SemiBold.ttf"),
        fetchBytes("/fonts/Inter-ExtraBold.ttf"),
        fetchBytes("/logo-microbalade.png"),
      ]);
      const bytes = await buildPoster({
        format,
        url: trackingUrl,
        shortUrl,
        communeName: displayName,
        qrColor: color,
        townLogo: activeLogo?.pdf ?? (logo?.pdf || null),
        microLogo,
        fonts: { regular, semibold, extrabold },
      });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      triggerDownload(url, `microbalade-affichette-${format.toLowerCase()}-${slug ?? "commune"}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error(e);
      toast.error("Impossible de générer l'affichette.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
          <QrIcon size={22} className="text-primary" /> QR code Microbalade
        </h1>
        <p className="text-sm text-muted-foreground">
          Téléchargez votre QR code unique pour vos supports de communication :
          flyers, panneaux, journal municipal, site web, signalétique.
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 grid md:grid-cols-[auto,1fr] gap-6 items-start">
        <div className="w-56 h-56 bg-background rounded-2xl border border-border p-3 flex items-center justify-center shadow-sm">
          {loading || !previewUrl ? (
            <Loader2 className="text-muted-foreground animate-spin" size={28} />
          ) : (
            <img src={previewUrl} alt="QR code Microbalade" className="w-full h-full object-contain" />
          )}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">URL pointée</div>
            <code className="block text-xs text-foreground bg-muted rounded-lg px-3 py-2 break-all">{trackingUrl}</code>
            <p className="text-xs text-muted-foreground mt-2">Chaque scan est compté dans vos statistiques.</p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Couleur du QR code</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={isValidHex(colorInput) && colorInput.length === 7 ? colorInput : "#0a0a0a"}
                onChange={(e) => setColorInput(e.target.value)}
                className="h-10 w-12 rounded-lg border border-border bg-background cursor-pointer"
                aria-label="Choisir une couleur"
              />
              <input
                type="text"
                value={colorInput}
                onChange={(e) => setColorInput(e.target.value)}
                className="h-10 w-28 rounded-lg border border-border bg-background px-3 text-sm font-mono"
                aria-label="Code couleur"
              />
              <button onClick={applyColor} className="h-10 px-4 rounded-xl bg-secondary text-foreground text-sm font-semibold hover:bg-secondary/80">
                Appliquer
              </button>
              <button
                onClick={() => {
                  setColorInput("#0a0a0a");
                  setColor("#0a0a0a");
                }}
                className="h-10 px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground"
              >
                Noir
              </button>
            </div>
            <label className={`flex items-center gap-2 text-sm ${logoUrl ? "text-foreground" : "text-muted-foreground"}`}>
              <input type="checkbox" checked={withLogo} disabled={!logoUrl || !logo} onChange={(e) => setWithLogo(e.target.checked)} />
              Logo de la ville au centre
              {!logoUrl && <span className="text-xs">(chargez un logo dans « Personnalisation »)</span>}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <DownloadButton onClick={() => downloadRaster("png")} label="PNG" />
            <DownloadButton onClick={() => downloadRaster("png-t")} label="PNG transparent" />
            <DownloadButton onClick={() => downloadRaster("jpg")} label="JPG" />
            <DownloadButton onClick={downloadSvg} label="SVG" />
          </div>
          <div className="flex flex-wrap gap-2">
            <DownloadButton onClick={() => downloadPoster("A4")} label="Affichette A4 (PDF)" icon="doc" busy={busy === "A4"} />
            <DownloadButton onClick={() => downloadPoster("A5")} label="Affichette A5 (PDF)" icon="doc" busy={busy === "A5"} />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold text-foreground mb-2">Conseils d'utilisation</h2>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li><strong className="text-foreground">Affichettes A4 / A5</strong> : prêtes à imprimer (vitrines, panneaux d'affichage, accueil).</li>
          <li><strong className="text-foreground">PNG / JPG</strong> : flyers, affiches, journal municipal.</li>
          <li><strong className="text-foreground">SVG</strong> : grand format (panneaux, kakemonos) sans perte de qualité.</li>
          <li>Taille minimale recommandée à l'impression : 3 × 3 cm.</li>
          <li>Conservez un contour blanc autour du QR code pour garantir la lecture.</li>
        </ul>
      </div>
    </section>
  );
}

function DownloadButton({ onClick, label, icon, busy }: { onClick: () => void; label: string; icon?: "doc"; busy?: boolean }) {
  const Icon = icon === "doc" ? FileText : Download;
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all disabled:opacity-70"
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
      {label}
    </button>
  );
}
