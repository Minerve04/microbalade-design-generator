import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, QrCode as QrIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  communeName: string;
  codePostal: string | null;
}

const BASE_URL = "https://www.microbalade.fr";

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "microbalade";
}

export default function CommuneQrCode({ communeName, codePostal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [svgMarkup, setSvgMarkup] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Unique tracking URL per commune (visible to user, also useful for stats).
  const trackingUrl = `${BASE_URL}/?source=qr&commune=${encodeURIComponent(
    slugify(communeName)
  )}${codePostal ? `&cp=${encodeURIComponent(codePostal)}` : ""}`;

  const fileBase = `microbalade-qr-${slugify(communeName)}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (canvasRef.current) {
          await QRCode.toCanvas(canvasRef.current, trackingUrl, {
            width: 512,
            margin: 2,
            errorCorrectionLevel: "H",
            color: { dark: "#0a0a0a", light: "#ffffff" },
          });
        }
        const svg = await QRCode.toString(trackingUrl, {
          type: "svg",
          margin: 2,
          errorCorrectionLevel: "H",
          color: { dark: "#0a0a0a", light: "#ffffff" },
        });
        if (!cancelled) setSvgMarkup(svg);
      } catch (e) {
        toast.error("Impossible de générer le QR code.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackingUrl]);

  const triggerDownload = (href: string, ext: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = `${fileBase}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadPng = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(trackingUrl, {
        width: 2048,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#0a0a0a", light: "#ffffff" },
      });
      triggerDownload(dataUrl, "png");
    } catch {
      toast.error("Erreur lors du téléchargement PNG.");
    }
  };

  const downloadPngTransparent = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(trackingUrl, {
        width: 2048,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#0a0a0a", light: "#00000000" },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileBase}-transparent.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error("Erreur lors du téléchargement PNG transparent.");
    }
  };

  const downloadJpg = async () => {
    try {
      const canvas = document.createElement("canvas");
      await QRCode.toCanvas(canvas, trackingUrl, {
        width: 2048,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#0a0a0a", light: "#ffffff" },
      });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
      triggerDownload(dataUrl, "jpg");
    } catch {
      toast.error("Erreur lors du téléchargement JPG.");
    }
  };

  const downloadSvg = () => {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "svg");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadPdf = async () => {
    try {
      const dataUrl = await QRCode.toDataURL(trackingUrl, {
        width: 1024,
        margin: 2,
        errorCorrectionLevel: "H",
      });
      // Minimal single-page A4 PDF embedding the PNG. No external deps.
      const pngBytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
      const pdfParts: (string | Uint8Array)[] = [];
      const offsets: number[] = [];
      let pos = 0;
      const push = (chunk: string | Uint8Array) => {
        const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        pdfParts.push(bytes);
        pos += bytes.byteLength;
      };
      const addObj = (body: string | Uint8Array) => {
        offsets.push(pos);
        push(`${offsets.length} 0 obj\n`);
        push(body);
        push("\nendobj\n");
      };
      push("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n");
      addObj("<< /Type /Catalog /Pages 2 0 R >>");
      addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
      addObj(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>"
      );
      // Image XObject
      const header = `<< /Type /XObject /Subtype /Image /Width 1024 /Height 1024 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pngBytes.byteLength} >>\nstream\n`;
      offsets.push(pos);
      push(`4 0 obj\n`);
      push(header);
      push(pngBytes);
      push("\nendstream\nendobj\n");
      addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
      const safeUrl = trackingUrl.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      const content = `q\n400 0 0 400 97 250 cm\n/Im0 Do\nQ\nBT /F1 10 Tf 80 200 Td (${safeUrl}) Tj ET\n`;
      addObj(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
      const xrefStart = pos;
      push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
      offsets.forEach((o) => push(`${o.toString().padStart(10, "0")} 00000 n \n`));
      push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
      const blob = new Blob(pdfParts as BlobPart[], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, "pdf");
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Fallback: just download the PNG if the PDF embedding fails.
      toast.error("PDF indisponible, téléchargement en PNG à la place.");
      downloadPng();
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

      <div className="bg-card border border-border rounded-2xl p-6 grid md:grid-cols-[auto,1fr] gap-6 items-center">
        <div className="w-56 h-56 bg-white rounded-2xl border border-border p-3 flex items-center justify-center shadow-sm">
          {loading ? (
            <Loader2 className="text-muted-foreground animate-spin" size={28} />
          ) : (
            <canvas ref={canvasRef} className="w-full h-full" />
          )}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              URL pointée
            </div>
            <code className="block text-xs text-foreground bg-muted rounded-lg px-3 py-2 break-all">
              {trackingUrl}
            </code>
            <p className="text-xs text-muted-foreground mt-2">
              Chaque scan est tracé dans vos statistiques (source : QR&nbsp;code).
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <DownloadButton onClick={downloadPng} label="PNG" />
            <DownloadButton onClick={downloadPngTransparent} label="PNG transparent" />
            <DownloadButton onClick={downloadJpg} label="JPG" />
            <DownloadButton onClick={downloadSvg} label="SVG" />
            <DownloadButton onClick={downloadPdf} label="PDF" />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        <h2 className="font-semibold text-foreground mb-2">Conseils d'utilisation</h2>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>
            <strong className="text-foreground">PNG / JPG</strong> : pour impression
            classique (flyers, affiches, journal municipal).
          </li>
          <li>
            <strong className="text-foreground">SVG / PDF</strong> : pour impression
            grand format (panneaux, kakemonos) sans perte de qualité.
          </li>
          <li>Taille minimale recommandée à l'impression : 3 × 3 cm.</li>
          <li>Conservez un contour blanc autour du QR code pour garantir la lecture.</li>
        </ul>
      </div>
    </section>
  );
}

function DownloadButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/25 hover:shadow-xl transition-all"
    >
      <Download size={15} />
      {label}
    </button>
  );
}
