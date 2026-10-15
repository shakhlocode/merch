'use client'
import {toCsv} from '@/lib/utils'

export default function CsvDownload({rows,filename,label='Экспорт CSV'}:{rows:Record<string,string>[];filename:string;label?:string}) {
  return <button type="button" className="ao-light-btn" disabled={!rows.length} onClick={()=>{
    const url=URL.createObjectURL(new Blob(['\uFEFF'+toCsv(rows)],{type:'text/csv;charset=utf-8;'}))
    const a=document.createElement('a');a.href=url;a.download=filename;a.click()
    setTimeout(()=>URL.revokeObjectURL(url),30000)
  }}>{label}</button>
}
