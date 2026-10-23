const $ = (selector) => document.querySelector(selector);
const API = String(window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");
const form = $("#order-form"), quantityInput = $("#quantity"), submitButton = $("#submit-button"), message = $("#form-message");
let config = null, activeOrderId = new URLSearchParams(location.search).get("order_id"), statusPoller = null;

function rupiah(value) { return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value||0)); }
function showMessage(text, success=false) { message.textContent=text; message.style.color=success?"#047857":"#b91c1c"; }
async function api(path, options={}) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(()=>({error:"Respons server tidak valid."}));
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status}).`);
  return data;
}
function updateTotal(){if(config)$("#total").textContent=rupiah(config.ticketPrice*Number(quantityInput.value));}
async function loadConfig(){
  config=await api("/api/config");
  $("#price").textContent=rupiah(config.ticketPrice);$("#sold").textContent=config.sold;$("#limit").textContent=config.ticketLimit;
  $("#event-date").textContent=config.eventDate;$("#ticket-date").textContent=config.eventDate;updateTotal();
}
quantityInput.addEventListener("change",updateTotal);

form.addEventListener("submit",async(event)=>{
  event.preventDefault();submitButton.disabled=true;showMessage("Menyiapkan pesanan dan menghubungkan pembayaran…",true);
  try{
    const order=await api("/api/create-order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      name:$("#name").value.trim(),email:$("#email").value.trim(),phone:$("#phone").value.trim(),quantity:Number(quantityInput.value)
    })});
    activeOrderId=order.orderId;history.replaceState({},"",`/?order_id=${encodeURIComponent(activeOrderId)}`);
    if(!order.invoiceUrl)throw new Error("Tautan pembayaran tidak diterima dari server.");
    showMessage("Pesanan dibuat. Kamu akan diarahkan ke halaman pembayaran aman.",true);
    location.href=order.invoiceUrl;
  }catch(error){showMessage(error.message||"Terjadi kesalahan. Silakan coba lagi.");}
  finally{submitButton.disabled=false;}
});
function showOrderSection(){$("#order-section").hidden=false;$("#order-section").scrollIntoView({behavior:"smooth",block:"start"});}
async function refreshOrder(){
  if(!activeOrderId)return;showOrderSection();$("#order-heading").textContent="Memeriksa pembayaran…";$("#ticket-output").hidden=true;
  try{
    const data=await api(`/api/order/${encodeURIComponent(activeOrderId)}`);
    $("#order-number").textContent=`Kode pesanan: ${data.orderId}`;
    if(data.paymentStatus==="paid"&&data.tickets?.length){
      $("#order-heading").textContent="Pembayaran berhasil!";
      $("#order-message").textContent=`Terima kasih, ${data.name}. Simpan masing-masing QR Code untuk check-in.`;
      $("#ticket-output").hidden=false;const list=$("#ticket-list");list.replaceChildren();
      for(const ticket of data.tickets){
        const card=document.createElement("article");card.className="ticket-paper";
        const top=document.createElement("div");top.className="ticket-top";
        const title=document.createElement("div");title.innerHTML='<span class="section-kicker">E-TICKET</span><h3>GENFEST FUN RUN</h3>';
        const badge=document.createElement("span");badge.className="ticket-badge";badge.textContent="2026";top.append(title,badge);
        const holder=document.createElement("p");holder.className="ticket-holder";holder.textContent=data.name;
        const qrBox=document.createElement("div");qrBox.className="ticket-qr";const canvas=document.createElement("canvas");qrBox.append(canvas);
        const code=document.createElement("div");code.className="ticket-code";code.textContent=ticket.ticketCode;
        const note=document.createElement("div");note.className="ticket-small";note.textContent=`Tiket berlaku untuk satu kali check-in · ${data.eventDate}`;
        card.append(top,holder,qrBox,code,note);list.append(card);
        await QRCode.toCanvas(canvas,ticket.ticketCode,{width:190,margin:1,errorCorrectionLevel:"H"});
      }
    }else if(data.paymentStatus==="failed"||data.paymentStatus==="cancelled"){
      $("#order-heading").textContent="Pembayaran belum berhasil";$("#order-message").textContent="Transaksi gagal atau dibatalkan. Jika saldo terpotong, hubungi panitia dan dukungan payment gateway.";
    }else{
      $("#order-heading").textContent="Menunggu pembayaran";$("#order-message").textContent="Pembayaran belum terkonfirmasi oleh server. Tunggu beberapa saat lalu periksa lagi.";
    }
  }catch(error){$("#order-heading").textContent="Status belum tersedia";$("#order-message").textContent=error.message;}
}
$("#refresh-order").addEventListener("click",refreshOrder);
$("#print-tickets").addEventListener("click",()=>window.print());

function startStatusPolling(){
  if(statusPoller)clearInterval(statusPoller);
  let attempts=0;
  statusPoller=setInterval(async()=>{
    attempts++;
    await refreshOrder();
    if(attempts>=36||!activeOrderId) {clearInterval(statusPoller);statusPoller=null;}
    const heading=$("#order-heading").textContent;
    if(heading==="Pembayaran berhasil!"||heading==="Pembayaran belum berhasil") {clearInterval(statusPoller);statusPoller=null;}
  },5000);
}
(async()=>{try{await loadConfig();if(activeOrderId){await refreshOrder();if($("#order-heading").textContent==="Menunggu pembayaran")startStatusPolling();}}catch(error){showMessage(error.message||"Website gagal dimuat.");}})();
