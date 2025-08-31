export default function Placeholder({ title, note, back }:{
  title:string; note?:string; back:()=>void;
}) {
  return (
    <>
      <div className="breadcrumbs"><a onClick={back} style={{cursor:"pointer"}}>← 返回</a></div>
      <div className="h1">{title}</div>
      <div style={{color:"#9aa4b2", marginTop:6}}>{note || "施工中，稍后接入后端模块…"}</div>
      <hr className="sep"/>
      <p>UI 已就位。等你指令我把对应 Rust 命令接上：LibreOffice 互转、pdfium 渲染、qpdf 压缩、lopdf 编辑、签章/OCR 等。</p>
    </>
  );
}
