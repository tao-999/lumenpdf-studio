import React from "react";

export default function PadOrPreview({
  stampUrl,
  onDone,
  pickStamp,
  setDraggingStamp,
}: {
  stampUrl: string | null;
  onDone: (png: Uint8Array) => void;    // 兼容后续“手写板”接入
  pickStamp: () => void;
  setDraggingStamp: (b: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", margin: "12px 0" }}>
      <div style={{ fontWeight: 600, opacity: .8 }}>签名素材：</div>
      {stampUrl ? (
        <img
          src={stampUrl}
          draggable
          onDragStart={(e) => {
            setDraggingStamp(true);
            // 自定义 MIME，PDF 舞台据此允许 drop
            e.dataTransfer?.setData("application/x-signature-stamp", "1");
            // 让拖影更小：偏移到图中心
            const img = e.currentTarget;
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            try { e.dataTransfer?.setDragImage(img, w/2, h/2); } catch {}
          }}
          onDragEnd={() => setDraggingStamp(false)}
          alt="签名预览"
          style={{ height: 48, objectFit: "contain", border: "1px dashed #777", padding: 4, background: "var(--panel-bg,#111)" }}
          title="拖到右侧 PDF 页面以放置签名"
        />
      ) : (
        <button className="btn" onClick={pickStamp}>上传签名图</button>
      )}
    </div>
  );
}
