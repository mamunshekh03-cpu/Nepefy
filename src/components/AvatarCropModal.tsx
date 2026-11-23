import React, { useEffect, useRef, useState } from 'react';
import { Move, RotateCw, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface AvatarCropModalProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onApply: (croppedDataUrl: string) => void;
}

const STAGE_SIZE = 280;
const CROP_SIZE = 220;
const OUTPUT_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  open,
  imageSrc,
  onClose,
  onApply,
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !imageSrc) {
      setImgSize(null);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
      setLoadError(null);
      return;
    }

    setImgSize(null);
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setLoadError(null);

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    };
    img.onerror = () => {
      setLoadError('Unable to decode this image file. Please try a PNG or JPG photo.');
    };
    img.src = imageSrc;
  }, [open, imageSrc]);

  if (!open || !imageSrc) return null;

  const getBounds = (nextZoom: number, nextRotation: number) => {
    if (!imgSize) {
      return { baseScale: 1, scale: 1, maxOffsetX: 0, maxOffsetY: 0 };
    }
    const swapped = nextRotation % 180 !== 0;
    const effW = swapped ? imgSize.height : imgSize.width;
    const effH = swapped ? imgSize.width : imgSize.height;
    const baseScale = Math.max(CROP_SIZE / effW, CROP_SIZE / effH);
    const scale = baseScale * nextZoom;
    const maxOffsetX = Math.max(0, (effW * scale - CROP_SIZE) / 2);
    const maxOffsetY = Math.max(0, (effH * scale - CROP_SIZE) / 2);
    return { baseScale, scale, maxOffsetX, maxOffsetY };
  };

  const clampOffset = (
    x: number,
    y: number,
    nextZoom: number,
    nextRotation: number
  ): { x: number; y: number } => {
    const { maxOffsetX, maxOffsetY } = getBounds(nextZoom, nextRotation);
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, y)),
    };
  };

  const { scale, maxOffsetX, maxOffsetY } = getBounds(zoom, rotation);
  const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offset.x));
  const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offset.y));

  const handleZoomChange = (nextZoom: number) => {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextZoom.toFixed(2))));
    setZoom(clampedZoom);
    setOffset((prev) => clampOffset(prev.x, prev.y, clampedZoom, rotation));
  };

  const handleRotate = () => {
    const nextRot = (rotation + 90) % 360;
    setRotation(nextRot);
    setOffset((prev) => clampOffset(prev.x, prev.y, zoom, nextRot));
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: clampedX,
      origOffsetY: clampedY,
    };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    const dx = e.clientX - dragStateRef.current.startX;
    const dy = e.clientY - dragStateRef.current.startY;
    setOffset(
      clampOffset(
        dragStateRef.current.origOffsetX + dx,
        dragStateRef.current.origOffsetY + dy,
        zoom,
        rotation
      )
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current) {
      dragStateRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore release error
      }
    }
  };

  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !imgSize) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = OUTPUT_SIZE / CROP_SIZE;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2 + clampedX * ratio, OUTPUT_SIZE / 2 + clampedY * ratio);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale * ratio, scale * ratio);
    ctx.drawImage(img, -imgSize.width / 2, -imgSize.height / 2);
    ctx.restore();

    onApply(canvas.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-crop-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 id="avatar-crop-title" className="text-base font-semibold text-slate-900">
              Adjust &amp; Crop Photo
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Drag to reposition and zoom to frame your profile picture.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photo editor"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Crop Canvas Area */}
        <div className="p-5 space-y-4">
          {loadError ? (
            <div className="py-12 px-4 text-center text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl">
              {loadError}
            </div>
          ) : (
            <>
              <div className="flex flex-col items-center">
                <div
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ width: STAGE_SIZE, height: STAGE_SIZE }}
                  className={`relative rounded-xl bg-slate-950 overflow-hidden select-none touch-none ${
                    dragging ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                >
                  {imgSize && (
                    <img
                      src={imageSrc}
                      alt="Crop preview"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: imgSize.width,
                        height: imgSize.height,
                        maxWidth: 'none',
                        maxHeight: 'none',
                        transformOrigin: 'center center',
                        transform: `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px)) scale(${scale}) rotate(${rotation}deg)`,
                      }}
                    />
                  )}

                  {/* Crop Frame + Outer Mask */}
                  <div
                    style={{
                      width: CROP_SIZE,
                      height: CROP_SIZE,
                      boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.58)',
                    }}
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-white/90"
                  >
                    {/* Subtle Rule-of-Thirds Grid */}
                    <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
                    <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
                  </div>
                </div>

                <div className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Move className="w-3 h-3" />
                  <span>Drag image to adjust position</span>
                </div>
              </div>

              {/* Zoom & Rotate Controls */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleZoomChange(zoom - 0.15)}
                    disabled={zoom <= MIN_ZOOM}
                    aria-label="Zoom out"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>

                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.01}
                    value={zoom}
                    onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                    aria-label="Zoom level"
                    className="flex-1 h-1.5 accent-blue-600 cursor-pointer"
                  />

                  <button
                    type="button"
                    onClick={() => handleZoomChange(zoom + 0.15)}
                    disabled={zoom >= MAX_ZOOM}
                    aria-label="Zoom in"
                    className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>

                  <span className="w-11 text-right text-xs font-mono-tabular font-semibold text-slate-700">
                    {zoom.toFixed(1)}x
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={handleRotate}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 rounded-lg transition-colors"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-blue-600" />
                    <span>Rotate 90°</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!imgSize || Boolean(loadError)}
            onClick={handleApply}
            className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            Apply &amp; Save
          </button>
        </div>
      </div>
    </div>
  );
};
