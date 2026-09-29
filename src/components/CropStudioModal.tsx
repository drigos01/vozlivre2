import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Crop,
  X,
  ZoomIn,
  Move,
  RotateCcw,
  Check,
  Eye,
  Crosshair,
  Sliders,
  Grid,
} from 'lucide-react';
import { VideoAspectRatio } from '../types';

export interface MediaCropSettings {
  enabled: boolean;
  zoom: number; // 1.0 (100%) to 3.0 (300%)
  panX: number; // -50% to +50%
  panY: number; // -50% to +50%
  aspectPreset: 'auto' | '16:9' | '9:16' | '1:1' | '4:5' | 'free';
}

interface CropStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  mediaWidth: number;
  mediaHeight: number;
  aspectRatio: VideoAspectRatio;
  currentCrop: MediaCropSettings;
  onSaveCrop: (newSettings: MediaCropSettings) => void;
}

/**
 * Robust proportional crop calculator:
 * Guarantees zero stretching, zero distortion, and exact aspect ratio mapping.
 */
export const calculateCropRect = (
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
  crop: MediaCropSettings
) => {
  const targetRatio = destW / destH;
  const mediaRatio = sourceW / sourceH;

  let baseW = sourceW;
  let baseH = sourceH;

  if (mediaRatio > targetRatio) {
    // Media is wider than target format
    baseH = sourceH;
    baseW = sourceH * targetRatio;
  } else {
    // Media is taller than target format
    baseW = sourceW;
    baseH = sourceW / targetRatio;
  }

  const zoom = Math.max(1.0, crop.zoom || 1.0);
  const cropW = baseW / zoom;
  const cropH = baseH / zoom;

  const maxPanX = (sourceW - cropW) / 2;
  const maxPanY = (sourceH - cropH) / 2;

  const offsetX = (crop.panX / 50) * maxPanX;
  const offsetY = (crop.panY / 50) * maxPanY;

  const sX = Math.max(0, Math.min(sourceW - cropW, (sourceW - cropW) / 2 + offsetX));
  const sY = Math.max(0, Math.min(sourceH - cropH, (sourceH - cropH) / 2 + offsetY));

  return { sX, sY, cropW, cropH };
};

export const CropStudioModal: React.FC<CropStudioModalProps> = ({
  isOpen,
  onClose,
  mediaUrl,
  mediaType,
  mediaWidth,
  mediaHeight,
  aspectRatio,
  currentCrop,
  onSaveCrop,
}) => {
  const [zoom, setZoom] = useState<number>(currentCrop.zoom || 1.0);
  const [panX, setPanX] = useState<number>(currentCrop.panX || 0);
  const [panY, setPanY] = useState<number>(currentCrop.panY || 0);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

  // Dragging interaction state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number }>({
    x: 0,
    y: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaElementRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  // Target aspect ratio dimensions
  const getTargetDimensions = useCallback(() => {
    switch (aspectRatio) {
      case '9:16':
        return { w: 720, h: 1280 };
      case '1:1':
        return { w: 720, h: 720 };
      case '16:9':
      default:
        return { w: 1280, h: 720 };
    }
  }, [aspectRatio]);

  // Sync internal state when modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(currentCrop.zoom || 1.0);
      setPanX(currentCrop.panX || 0);
      setPanY(currentCrop.panY || 0);
    }
  }, [isOpen, currentCrop]);

  // Load media into memory for canvas drawing
  useEffect(() => {
    if (!isOpen || !mediaUrl) return;

    if (mediaType === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = mediaUrl;
      img.onload = () => {
        mediaElementRef.current = img;
        drawCanvases();
      };
    } else {
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.src = mediaUrl;
      vid.muted = true;
      vid.playsInline = true;
      vid.currentTime = 0.1;
      vid.onloadeddata = () => {
        mediaElementRef.current = vid;
        drawCanvases();
      };
    }
  }, [isOpen, mediaUrl, mediaType]);

  // Redraw canvases on changes
  const drawCanvases = useCallback(() => {
    const media = mediaElementRef.current;
    if (!media) return;

    const sourceW =
      media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth || mediaWidth || 1280;
    const sourceH =
      media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight || mediaHeight || 720;

    if (!sourceW || !sourceH) return;

    const { w: targetW, h: targetH } = getTargetDimensions();
    const tempCrop: MediaCropSettings = {
      enabled: true,
      zoom,
      panX,
      panY,
      aspectPreset: 'auto',
    };

    const { sX, sY, cropW, cropH } = calculateCropRect(sourceW, sourceH, targetW, targetH, tempCrop);

    // 1. Draw Overview Canvas (Full media visible from edge to edge, with glowing crop window)
    const oCanvas = overviewCanvasRef.current;
    if (oCanvas) {
      const ctx = oCanvas.getContext('2d');
      if (ctx) {
        const cW = oCanvas.width;
        const cH = oCanvas.height;

        ctx.clearRect(0, 0, cW, cH);

        // Fill background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, cW, cH);

        // Fit whole media into canvas (object-contain) so NO pixel is cut off
        const scale = Math.min((cW - 24) / sourceW, (cH - 24) / sourceH);
        const dw = sourceW * scale;
        const dh = sourceH * scale;
        const dx = (cW - dw) / 2;
        const dy = (cH - dh) / 2;

        // Draw original media complete
        ctx.drawImage(media, dx, dy, dw, dh);

        // Calculate crop rectangle on overview canvas
        const bx = dx + (sX / sourceW) * dw;
        const by = dy + (sY / sourceH) * dh;
        const bw = (cropW / sourceW) * dw;
        const bh = (cropH / sourceH) * dh;

        // Draw darkened overlay over the areas that will NOT be in the video
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        // Top
        ctx.fillRect(0, 0, cW, by);
        // Bottom
        ctx.fillRect(0, by + bh, cW, cH - (by + bh));
        // Left
        ctx.fillRect(0, by, bx, bh);
        // Right
        ctx.fillRect(bx + bw, by, cW - (bx + bw), bh);

        // Draw Crop Window Border (Emerald / Glowing)
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Rule of thirds grid
        if (showGrid) {
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
          ctx.lineWidth = 1;

          // Vertical lines
          ctx.beginPath();
          ctx.moveTo(bx + bw / 3, by);
          ctx.lineTo(bx + bw / 3, by + bh);
          ctx.moveTo(bx + (bw * 2) / 3, by);
          ctx.lineTo(bx + (bw * 2) / 3, by + bh);

          // Horizontal lines
          ctx.moveTo(bx, by + bh / 3);
          ctx.lineTo(bx + bw, by + bh / 3);
          ctx.moveTo(bx, by + (bh * 2) / 3);
          ctx.lineTo(bx + bw, by + (bh * 2) / 3);
          ctx.stroke();

          // Center crosshair
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.beginPath();
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          ctx.moveTo(cx - 8, cy);
          ctx.lineTo(cx + 8, cy);
          ctx.moveTo(cx, cy - 8);
          ctx.lineTo(cx, cy + 8);
          ctx.stroke();
        }

        // Corner handles
        const handleLen = Math.min(16, bw * 0.15);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        // Top-Left
        ctx.beginPath();
        ctx.moveTo(bx, by + handleLen);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + handleLen, by);
        // Top-Right
        ctx.moveTo(bx + bw - handleLen, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw, by + handleLen);
        // Bottom-Left
        ctx.moveTo(bx, by + bh - handleLen);
        ctx.lineTo(bx, by + bh);
        ctx.lineTo(bx + handleLen, by + bh);
        // Bottom-Right
        ctx.moveTo(bx + bw - handleLen, by + bh);
        ctx.lineTo(bx + bw, by + bh);
        ctx.lineTo(bx + bw, by + bh - handleLen);
        ctx.stroke();
      }
    }

    // 2. Draw Result Canvas (Exactly what the 16:9 / 9:16 video will look like)
    const rCanvas = resultCanvasRef.current;
    if (rCanvas) {
      const ctx = rCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, rCanvas.width, rCanvas.height);
        ctx.drawImage(media, sX, sY, cropW, cropH, 0, 0, rCanvas.width, rCanvas.height);
      }
    }
  }, [
    mediaWidth,
    mediaHeight,
    getTargetDimensions,
    zoom,
    panX,
    panY,
    showGrid,
  ]);

  useEffect(() => {
    drawCanvases();
  }, [drawCanvases]);

  // Pointer drag on overview canvas to slide crop box intuitively
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: panX,
      startPanY: panY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    // Convert pixel delta to percentage (-50 to +50)
    const factor = 0.35 / zoom;
    const newPanX = Math.max(-50, Math.min(50, Math.round(dragStartRef.current.startPanX + deltaX * factor)));
    const newPanY = Math.max(-50, Math.min(50, Math.round(dragStartRef.current.startPanY + deltaY * factor)));

    setPanX(newPanX);
    setPanY(newPanY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleSave = () => {
    onSaveCrop({
      enabled: true,
      zoom,
      panX,
      panY,
      aspectPreset: 'auto',
    });
    onClose();
  };

  const handleReset = () => {
    setZoom(1.0);
    setPanX(0);
    setPanY(0);
    onSaveCrop({
      enabled: false,
      zoom: 1.0,
      panX: 0,
      panY: 0,
      aspectPreset: 'auto',
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <Crop className="h-5 w-5 text-emerald-400" />
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>Estúdio de Corte & Enquadramento</span>
                <span className="text-[10px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded">
                  {aspectRatio}
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400">
                A imagem completa é exibida abaixo sem nenhum corte. Arraste ou use os controles para escolher o ponto exato.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* View Tabs on Mobile */}
        <div className="flex sm:hidden border-b border-neutral-800 bg-neutral-950 px-3 py-1.5 gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`flex-1 py-1 rounded-md text-center font-medium ${
              activeTab === 'editor' ? 'bg-white text-neutral-950 font-bold' : 'text-neutral-400'
            }`}
          >
            1. Enquadramento Completo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`flex-1 py-1 rounded-md text-center font-medium ${
              activeTab === 'preview' ? 'bg-white text-neutral-950 font-bold' : 'text-neutral-400'
            }`}
          >
            2. Resultado ({aspectRatio})
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
          {/* Main Visual Stage */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-center">
            {/* Overview Canvas: Complete image with interactive crop box */}
            <div
              className={`sm:col-span-8 space-y-1.5 ${
                activeTab !== 'editor' ? 'hidden sm:block' : ''
              }`}
            >
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="flex items-center gap-1.5 font-medium text-white">
                  <Eye className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Imagem Completa (Arraste para mover o corte):</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowGrid(!showGrid)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                    showGrid
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                >
                  Grade {showGrid ? 'Ligada' : 'Desligada'}
                </button>
              </div>

              <div className="relative w-full h-[220px] sm:h-[300px] bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center">
                <canvas
                  ref={overviewCanvasRef}
                  width={640}
                  height={340}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className="w-full h-full object-contain cursor-grab active:cursor-grabbing select-none touch-none"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-neutral-400 px-1">
                <span>Área escura = Fora do vídeo</span>
                <span className="text-emerald-400 font-medium">Caixa verde = Área gravada</span>
              </div>
            </div>

            {/* Live Result Preview Canvas */}
            <div
              className={`sm:col-span-4 space-y-1.5 ${
                activeTab !== 'preview' ? 'hidden sm:block' : ''
              }`}
            >
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span className="font-medium text-white flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Resultado no Vídeo ({aspectRatio}):</span>
                </span>
              </div>

              <div className="relative w-full h-[220px] sm:h-[300px] bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center p-2">
                <canvas
                  ref={resultCanvasRef}
                  width={aspectRatio === '9:16' ? 360 : aspectRatio === '1:1' ? 400 : 540}
                  height={aspectRatio === '9:16' ? 640 : aspectRatio === '1:1' ? 400 : 304}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-xl border border-neutral-800/80"
                />
              </div>
              <p className="text-[10px] text-neutral-400 text-center">
                Fidelidade total: o vídeo final terá exatamente este enquadramento.
              </p>
            </div>
          </div>

          {/* Controls Box */}
          <div className="bg-neutral-950 p-3.5 sm:p-4 rounded-xl border border-neutral-800 space-y-3.5">
            {/* Zoom Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <ZoomIn className="h-4 w-4 text-emerald-400" />
                  <span>Zoom / Escala do Corte:</span>
                </span>
                <span className="font-mono font-bold text-emerald-400">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={100}
                max={300}
                step={5}
                value={Math.round(zoom * 100)}
                onChange={(e) => setZoom(parseFloat(e.target.value) / 100)}
                className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>

            {/* Pan X and Pan Y Dual Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Pan X */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1">
                    <Move className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Horizontal (Pan X):</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-cyan-400 text-[11px] font-bold">
                      {panX > 0 ? `+${panX}%` : `${panX}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPanX(0)}
                      className="text-[10px] text-neutral-400 hover:text-white underline cursor-pointer"
                    >
                      Centrar
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={panX}
                  onChange={(e) => setPanX(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Pan Y */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1">
                    <Move className="h-3.5 w-3.5 text-purple-400" />
                    <span>Vertical (Pan Y):</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-purple-400 text-[11px] font-bold">
                      {panY > 0 ? `+${panY}%` : `${panY}%`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPanY(0)}
                      className="text-[10px] text-neutral-400 hover:text-white underline cursor-pointer"
                    >
                      Centrar
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={panY}
                  onChange={(e) => setPanY(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                />
              </div>
            </div>

            {/* Quick Framing Presets */}
            <div className="pt-2 border-t border-neutral-800/80 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-neutral-400 mr-1">Atalhos Rápidos:</span>
              <button
                type="button"
                onClick={() => {
                  setZoom(1.0);
                  setPanX(0);
                  setPanY(0);
                }}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded text-neutral-300 hover:text-white transition-colors cursor-pointer"
              >
                Corte Amplo (100%)
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1.3);
                  setPanX(0);
                  setPanY(-20);
                }}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded text-neutral-300 hover:text-white transition-colors cursor-pointer"
              >
                Foco no Topo / Rosto
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1.3);
                  setPanX(0);
                  setPanY(0);
                }}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded text-neutral-300 hover:text-white transition-colors cursor-pointer"
              >
                Centro 130%
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1.75);
                  setPanX(0);
                  setPanY(0);
                }}
                className="px-2 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded text-neutral-300 hover:text-white transition-colors cursor-pointer"
              >
                Close 175%
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-neutral-800 p-3 sm:p-4 bg-neutral-950 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            Remover Corte (Resetar)
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-6 py-2 text-xs font-bold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <Check className="h-4 w-4" />
              <span>Aplicar Corte</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
