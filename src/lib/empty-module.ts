// jsPDF 的可选依赖（html2canvas / dompurify / canvg）只在 doc.html()、addSvgAsImage 里用到，
// 我们只用 addImage，构建时替换成这个空模块，单文件少约 0.9MB。真被调用时直接报错，不会静默出错。
const unavailable = () => { throw new Error('此功能未打包（只支持 addImage）') }
export default unavailable
