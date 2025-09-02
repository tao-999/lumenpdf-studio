import React, { useEffect, useRef, useState } from "react";

export default function SignaturePad({
  onDone, onClose,
}: {
  onDone: (pngBytes: Uint8Array) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [strokeColor, setStrokeColor] = useState("#000000");

  useEffect(() => {
    const cvs = canvasRef.current!;
    // DPR 适配
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const W = 600, H = 180;
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    cvs.style.width = `${W}px`;
    cvs.style.height = `${H}px`;
    const ctx = cvs.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // ✅ 透明背景：不填充白底
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  function pos(e: React.PointerEvent) {
    const cvs = canvasRef.current!;
    const r = cvs.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setDrawing(true);
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    e.preventDefault();
  }
  function up(e: React.PointerEvent) {
    setDrawing(false);
    try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch {}
  }

  async function exportPNG() {
    const cvs = canvasRef.current!;
    const blob: Blob = await new Promise((res) => cvs.toBlob((b) => res(b!), "image/png")); // ✅ PNG + alpha
    const buf = await blob.arrayBuffer();
    onDone(new Uint8Array(buf));
  }

  function clearAll() {
    const cvs = canvasRef.current!;
    const ctx = cvs.getContext("2d")!;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: "90vw", background: "#1f1f1f", color: "#fff",
          borderRadius: 8, padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,.35)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16 }}>✍️ 手写签名</div>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <label>笔宽：</label>
          <input type="range" min={1} max={10} value={strokeWidth} onChange={e => setStrokeWidth(+e.target.value)} />
          <label>颜色：</label>
          <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)} />
          <button className="btn" onClick={clearAll}>清空</button>
        </div>

        <div style={{ borderRadius: 6, overflow: "hidden", background: "transparent", border: "1px dashed rgba(255,255,255,.25)" }}>
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{ display: "block", touchAction: "none", cursor: "crosshair" }}
          />
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={exportPNG}>使用</button>
        </div>
      </div>
    </div>
  );
}
