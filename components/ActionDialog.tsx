'use client'
import {useEffect,useRef,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
export default function ActionDialog({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{
    const dialog=ref.current
    if(!dialog)return
    const focus=document.activeElement,overflow=document.body.style.overflow
    document.body.style.overflow='hidden';dialog.showModal()
    return()=>{dialog.close();document.body.style.overflow=overflow;if(focus instanceof HTMLElement&&focus.isConnected)focus.focus({preventScroll:true})}
  },[])
  return createPortal(<dialog ref={ref} className="admin-action-dialog" aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose()}} onClose={e=>{if(!e.currentTarget.open)onClose()}}>
    <header><h2>{title}</h2><button type="button" aria-label="Закрыть окно" disabled={busy} onClick={onClose}>×</button></header>
    <div className="admin-action-body">{children}</div>
  </dialog>,document.body)
}
