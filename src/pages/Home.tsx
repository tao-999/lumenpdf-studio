type RouteSetter = (r: any)=>void;

const tools = [
  { key:"pdf2word",  name:"将 PDF 转换为 Word",   icon:"📄➡️📝", desc:"离线解析为 .docx", route:{name:"convert", kind:"pdf2word"} },
  { key:"word2pdf",  name:"将 Word 转换为 PDF",   icon:"📝➡️📄", desc:"批量支持 .docx", route:{name:"convert", kind:"word2pdf"} },
  { key:"pdf2jpg",   name:"将 PDF 转换为 JPG",    icon:"📄➡️🖼️", desc:"按页导出图片", route:{name:"convert", kind:"pdf2jpg"} },
  { key:"jpg2pdf",   name:"将 JPG 转换为 PDF",    icon:"🖼️➡️📄", desc:"多图合成 PDF", route:{name:"convert", kind:"jpg2pdf"} },

  { key:"pdf2excel", name:"将 PDF 转换为 Excel",  icon:"📄➡️📊", desc:"表格提取到 .xlsx", route:{name:"convert", kind:"pdf2excel"} },
  { key:"excel2pdf", name:"将 Excel 转换为 PDF",  icon:"📊➡️📄", desc:"保证分页样式", route:{name:"convert", kind:"excel2pdf"} },
  { key:"pdf2ppt",   name:"将 PDF 转换为 PowerPoint", icon:"📄➡️📽️", desc:"PPT 可编辑", route:{name:"convert", kind:"pdf2ppt"} },
  { key:"ppt2pdf",   name:"将 PowerPoint 转换为 PDF", icon:"📽️➡️📄", desc:"演示稿归档", route:{name:"convert", kind:"ppt2pdf"} },

  { key:"template",  name:"创建模板", icon:"➕📄", desc:"预置版式 + 表单域", route:{name:"template"} },
  { key:"split",     name:"拆分 PDF", icon:"✂️📄", desc:"按页/范围拆分", route:{name:"split"} },
  { key:"merge",     name:"合并 PDF", icon:"🧩📄", desc:"多文件拼接", route:{name:"merge"} },
  { key:"compress",  name:"压缩 PDF", icon:"🗜️📄", desc:"目标大小/质量", route:{name:"compress"} },

  { key:"edit",      name:"编辑 PDF", icon:"✏️📄", desc:"文本/高亮/形状/注释", route:{name:"edit"} },
  { key:"watermark", name:"添加水印", icon:"💧📄", desc:"文字/图片/页码", route:{name:"watermark"} },
  { key:"rotate",    name:"旋转/裁切", icon:"🔁✂️", desc:"90°/裁边/重排", route:{name:"rotate"} },
  { key:"sign",      name:"签署 PDF", icon:"🖋️✅", desc:"图章/数字签名", route:{name:"sign"} },
];

export default function Home({ go }: { go: RouteSetter }) {
  return (
    <>
      <div className="h1">PDF 工具箱</div>
      <div className="grid">
        {tools.map(t => (
          <div key={t.key} className="card" onClick={()=>go(t.route)}>
            <div className="icon">{t.icon}</div>
            <div className="name">{t.name}</div>
            <div className="desc">{t.desc}</div>
          </div>
        ))}
      </div>
    </>
  );
}
