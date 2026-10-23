const API = String(window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/,"");
const $ = s => document.querySelector(s);
let adminKey = "", allOrders = [], scanner = null, scannerRunning = false, checkinBusy = false;
const money = v => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(v||0));
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function api(path,options={}){
  const headers={...(options.headers||{}),"Authorization":`Bearer ${adminKey}`};
  if(options.body)headers["Content-Type"]="application/json";
  const response=await fetch(`${API}${path}`,{...options,headers});
  const data=await response.json().catch(()=>({error:"Respons server tidak valid."}));
  if(!response.ok)throw new Error(data.error||`Permintaan gagal (${response.status}).`);
  return data;
}
$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault();adminKey=$("#admin-key").value;$("#login-error").textContent="";
  try{await loadDashboard();$("#login-card").hidden=true;$("#dashboard").hidden=false;$("#admin-key").value="";}
  catch(err){$("#login-error").textContent=err.message;adminKey="";}
});
$("#logout-btn").addEventListener("click",async()=>{await stopScanner();adminKey="";allOrders=[];$("#dashboard").hidden=true;$("#login-card").hidden=false;$("#admin-key").value="";});
$("#reload-btn").addEventListener("click",()=>loadDashboard().catch(showFatal));
function showFatal(err){alert(err.message||"Terjadi kesalahan.");}
async function loadDashboard(){
  const data=await api("/api/admin/orders");
  allOrders=data.orders||[];
  $("#stat-orders").textContent=data.stats.orders;
  $("#stat-tickets").textContent=data.stats.tickets_paid;
  $("#stat-revenue").textContent=money(data.stats.revenue);
  $("#stat-checkins").textContent=allOrders.reduce((sum,o)=>sum+Number(o.checked_in_count||0),0);
  renderOrders();
}
function renderOrders(){
  const status=$("#filter-status").value, term=$("#search-orders").value.trim().toLowerCase();
  const rows=allOrders.filter(o=>(status==="all"||o.payment_status===status)&&[o.order_id,o.buyer_name,o.email].some(v=>String(v||"").toLowerCase().includes(term)));
  $("#table-count").textContent=`${rows.length} pesanan ditampilkan`;
  const body=$("#orders-body");body.replaceChildren();
  if(!rows.length){const tr=document.createElement("tr");tr.innerHTML='<td colspan="8">Tidak ada pesanan yang cocok.</td>';body.append(tr);return;}
  for(const o of rows){
    const tr=document.createElement("tr");
    const statusClass=["paid","pending","failed","cancelled"].includes(o.payment_status)?o.payment_status:"pending";
    const when=o.created_at?new Date(o.created_at).toLocaleString("id-ID"):"—";
    tr.innerHTML=`<td>${esc(o.order_id)}</td><td>${esc(o.buyer_name)}</td><td>${esc(o.email)}</td><td>${esc(o.quantity)}</td><td>${esc(money(o.total_amount))}</td><td><span class="state state-${statusClass}">${esc(o.payment_status)}</span></td><td>${esc(o.payment_type||"—")}</td><td>${esc(when)}</td>`;
    body.append(tr);
  }
}
$("#filter-status").addEventListener("change",renderOrders);$("#search-orders").addEventListener("input",renderOrders);
$("#export-btn").addEventListener("click",()=>{
  const rows=[["Kode Pesanan","Nama","Email","WhatsApp","Jumlah Tiket","Total","Status Pembayaran","Metode Pembayaran","Status Transaksi","Waktu Pesan","Waktu Lunas","Tiket Check-in"]];
  for(const o of allOrders)rows.push([o.order_id,o.buyer_name,o.email,o.phone,o.quantity,o.total_amount,o.payment_status,o.payment_type||"",o.transaction_status||"",o.created_at||"",o.paid_at||"",o.checked_in_count||0]);
  const csv="\uFEFF"+rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`genfest-orders-${new Date().toISOString().slice(0,10)}.csv`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
});
function showCheckin(message,success){const el=$("#checkin-result");el.textContent=message;el.className=`result ${success?"success":"fail"}`;}
async function submitCheckin(code){
  if(checkinBusy)return;checkinBusy=true;
  try{
    const result=await api("/api/admin/checkin",{method:"POST",body:JSON.stringify({ticketCode:code,checkedInBy:$("#staff-name").value.trim()||"Panitia"})});
    showCheckin(`✓ ${result.message} Kode: ${result.ticketCode}. Pesanan: ${result.orderId}.`,true);
    $("#ticket-code").value="";await loadDashboard();
  }catch(err){showCheckin(`✕ ${err.message}`,false);}
  finally{checkinBusy=false;}
}
$("#checkin-form").addEventListener("submit",e=>{e.preventDefault();const code=$("#ticket-code").value.trim();if(code)submitCheckin(code);});
async function startScanner(){
  if(scannerRunning)return;
  if(!window.Html5Qrcode){showCheckin("Library pemindai QR belum termuat. Periksa koneksi internet.",false);return;}
  try{
    scanner=new Html5Qrcode("qr-reader");
    await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async decodedText=>{
      await stopScanner();$("#ticket-code").value=decodedText.trim();await submitCheckin(decodedText.trim());
    },()=>{});
    scannerRunning=true;showCheckin("Kamera aktif. Arahkan ke QR Code tiket.",true);
  }catch(err){scanner=null;showCheckin(`Kamera tidak dapat dibuka: ${err.message||err}. Periksa izin kamera dan gunakan HTTPS.`,false);}
}
async function stopScanner(){
  if(scanner&&scannerRunning){try{await scanner.stop();}catch{}}
  if(scanner){try{scanner.clear();}catch{}}
  scanner=null;scannerRunning=false;
}
$("#start-scan").addEventListener("click",startScanner);$("#stop-scan").addEventListener("click",stopScanner);
