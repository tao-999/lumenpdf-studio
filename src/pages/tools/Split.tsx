import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { splitPdf } from "../../shared/api";

export default function Split({ back }:{ back:()=>void }) {
  const [file, setFile] = useState<string>("");
  const [ranges, setRanges] = useState<string>("1-3,8"); // 简单双向文本输入
  const [outDir, setOutDir] = useState<string>("");
  const [log, setLog] = useState("");

  function parseRanges(s: string): Array<[number,number]> {
    return s.split(",").map(x=>x.trim()).filter(Boolean).map(seg=>{
      if (seg.includes("-")) {
        const [a,b] = seg.split("-").map(n=>parseInt(n.trim(),10));
        return [Math.min(a,b), Math.max(a,b)] as [number,number];
      } else {
        const n = parseInt(seg,10);
        return [n,n] as [number,number];
      }
    });
  }

  async function pickFile() {
    const picked = await open({ multiple:false, filters:[{ name:"PDF", extensions:["pdf"] }] });
    if (picked && !Array.isArray(picked)) setFile(picked as string);
  }
  async function pickDir() {
    const dir = await open({ directory:true });
    if (dir && !Array.isArray(dir)) setOutDir(dir as string);
  }

  async function doSplit() {
    if (!file || !outDir) { setLog(l=>l+"\n请选择 PDF 与输出目录。"); return; }
    const rangesArr = parseRanges(ranges);
    try {
      const outs = await splitPdf(file, rangesArr, outDir);
      setLog(l=>l+`\n✅ 拆分完成：\n${(outs as string[]).join("\n")}`);
    } catch (e:any) {
      setLog(l=>l+`\n❌ 拆分失败：${e?.message || e}`);
    }
  }

  return (
    <>
      <div className="breadcrumbs"><a onClick={back} style={{cursor:"pointer"}}>← 返回</a></div>
      <div className="h1">拆分 PDF</div>
      <div className="toolbar" style={{gap:12, flexWrap:"wrap"}}>
        <button className="btn" onClick={pickFile}>选择 PDF</button>
        <div style={{opacity:.8, maxWidth:560, overflow:"hidden", textOverflow:"ellipsis"}}>{file || "未选择…"}</div>
      </div>

      <div className="toolbar" style={{gap:12, flexWrap:"wrap"}}>
        <button className="btn" onClick={pickDir}>选择输出目录</button>
        <div style={{opacity:.8}}>{outDir || "未选择…"}</div>
      </div>

      <div className="toolbar" style={{gap:12}}>
        <input
          value={ranges}
          onChange={e=>setRanges(e.target.value)}
          placeholder="页范围，例如：1-3,8,10-12"
          style={{background:"#111417", color:"#e8ecf1", border:"1px solid var(--bd)", borderRadius:10, padding:"10px 12px", width:340}}
        />
        <button className="btn primary" disabled={!file || !outDir} onClick={doSplit}>开始拆分</button>
      </div>

      <hr className="sep"/>
      <div className="log">{log || "日志输出…"}</div>
    </>
  );
}
